import { createHmac, timingSafeEqual } from 'crypto'
import axios, { AxiosInstance } from 'axios'

import { env } from '../config/keys.js'
import { ErrorResponse } from '../middlewares/error.middleware.js'

export interface InitializeTransactionInput {
  email: string
  amountNaira: number
  reference: string
  callbackUrl?: string
  metadata?: Record<string, unknown>
}

export interface PaystackInitializedTransaction {
  authorizationUrl: string
  accessCode: string
  reference: string
}

export interface PaystackVerifiedTransaction {
  reference: string
  status: string
  amountKobo: number
  currency: string
  paidAt?: string
  channel?: string
  metadata?: Record<string, unknown>
}

interface PaystackInitializeResponse {
  status: boolean
  message: string
  data: {
    authorization_url: string
    access_code: string
    reference: string
  }
}

interface PaystackVerifyResponse {
  status: boolean
  message: string
  data: {
    reference: string
    status: string
    amount: number
    currency: string
    paid_at?: string
    channel?: string
    metadata?: Record<string, unknown>
  }
}

export class PaystackService {
  private clientInstance?: AxiosInstance

  private get client(): AxiosInstance {
    if (!this.clientInstance) {
      this.clientInstance = axios.create({
        baseURL: env.PAYSTACK_API_URL.replace(/\/+$/, ''),
        timeout: 15_000,
        headers: {
          Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      })
    }

    return this.clientInstance
  }

  private validateNairaAmount(amountNaira: number): void {
    if (!Number.isInteger(amountNaira) || amountNaira <= 0) {
      throw new ErrorResponse(
        'Payment amount must be a positive whole-naira amount',
        400,
      )
    }
  }

  private convertNairaToKobo(amountNaira: number): number {
    this.validateNairaAmount(amountNaira)

    return amountNaira * 100
  }

  private getPaystackErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const responseData = error.response?.data as
        | { message?: string }
        | undefined

      return responseData?.message || error.message
    }

    if (error instanceof Error) {
      return error.message
    }

    return 'Unknown Paystack error'
  }

  async initializeTransaction(
    input: InitializeTransactionInput,
  ): Promise<PaystackInitializedTransaction> {
    const email = input.email.trim().toLowerCase()
    const reference = input.reference.trim()

    if (!email) {
      throw new ErrorResponse('Customer email is required', 400)
    }

    if (!reference) {
      throw new ErrorResponse('Payment reference is required', 400)
    }

    const amountKobo = this.convertNairaToKobo(input.amountNaira)

    try {
      const response = await this.client.post<PaystackInitializeResponse>(
        '/transaction/initialize',
        {
          email,
          amount: amountKobo,
          reference,
          callback_url: input.callbackUrl,
          metadata: input.metadata,
          currency: 'NGN',
        },
      )

      if (!response.data.status || !response.data.data.authorization_url) {
        throw new ErrorResponse(
          response.data.message || 'Paystack could not initialize payment',
          502,
        )
      }

      return {
        authorizationUrl: response.data.data.authorization_url,
        accessCode: response.data.data.access_code,
        reference: response.data.data.reference,
      }
    } catch (error: unknown) {
      if (error instanceof ErrorResponse) {
        throw error
      }

      throw new ErrorResponse(
        `Could not initialize payment: ${this.getPaystackErrorMessage(error)}`,
        502,
      )
    }
  }

  async verifyTransaction(
    reference: string,
    expectedAmountNaira: number,
  ): Promise<PaystackVerifiedTransaction> {
    const normalizedReference = reference.trim()

    if (!normalizedReference) {
      throw new ErrorResponse('Payment reference is required', 400)
    }

    const expectedAmountKobo =
      this.convertNairaToKobo(expectedAmountNaira)

    try {
      const response = await this.client.get<PaystackVerifyResponse>(
        `/transaction/verify/${encodeURIComponent(normalizedReference)}`,
      )

      const transaction = response.data.data

      if (!response.data.status || !transaction) {
        throw new ErrorResponse(
          response.data.message || 'Payment verification failed',
          502,
        )
      }

      if (transaction.reference !== normalizedReference) {
        throw new ErrorResponse(
          'Verified payment reference does not match the order',
          409,
        )
      }

      if (transaction.status !== 'success') {
        throw new ErrorResponse(
          `Payment is not successful. Current status: ${transaction.status}`,
          409,
        )
      }

      if (transaction.currency !== 'NGN') {
        throw new ErrorResponse(
          'Verified payment currency does not match the order currency',
          409,
        )
      }

      if (transaction.amount !== expectedAmountKobo) {
        throw new ErrorResponse(
          'Verified payment amount does not match the order total',
          409,
        )
      }

      return {
        reference: transaction.reference,
        status: transaction.status,
        amountKobo: transaction.amount,
        currency: transaction.currency,
        paidAt: transaction.paid_at,
        channel: transaction.channel,
        metadata: transaction.metadata,
      }
    } catch (error: unknown) {
      if (error instanceof ErrorResponse) {
        throw error
      }

      throw new ErrorResponse(
        `Could not verify payment: ${this.getPaystackErrorMessage(error)}`,
        502,
      )
    }
  }

  async refundTransaction(input: {
    transactionReference: string
    amountNaira?: number
    reason?: string
  }): Promise<{ reference: string; status: string }> {
    const transactionReference = input.transactionReference.trim()

    if (!transactionReference) {
      throw new ErrorResponse('Transaction reference is required', 400)
    }

    try {
      const response = await this.client.post<{
        status: boolean
        message: string
        data: { transaction_reference?: string; status?: string; refund_reference?: string }
      }>('/refund', {
        transaction: transactionReference,
        ...(input.amountNaira !== undefined
          ? { amount: this.convertNairaToKobo(input.amountNaira) }
          : {}),
        ...(input.reason ? { customer_note: input.reason, merchant_note: input.reason } : {}),
      })

      if (!response.data.status) {
        throw new ErrorResponse(response.data.message || 'Paystack could not process the refund', 502)
      }

      return {
        reference: response.data.data.refund_reference ?? transactionReference,
        status: response.data.data.status ?? 'pending',
      }
    } catch (error: unknown) {
      if (error instanceof ErrorResponse) {
        throw error
      }

      throw new ErrorResponse(`Could not process refund: ${this.getPaystackErrorMessage(error)}`, 502)
    }
  }

  private banksCache?: { fetchedAt: number; banks: { name: string; code: string }[] }
  private readonly banksCacheTtlMs = 24 * 60 * 60 * 1000 // the bank list is effectively static

  async listBanks(): Promise<{ name: string; code: string }[]> {
    if (this.banksCache && Date.now() - this.banksCache.fetchedAt < this.banksCacheTtlMs) {
      return this.banksCache.banks
    }

    try {
      const response = await this.client.get<{
        status: boolean
        message: string
        data: { name: string; code: string; active: boolean; country: string; currency: string }[]
      }>('/bank', { params: { country: 'nigeria', currency: 'NGN' } })

      if (!response.data.status) {
        throw new ErrorResponse(response.data.message || 'Could not fetch bank list', 502)
      }

      const banks = response.data.data
        .filter(bank => bank.active)
        .map(bank => ({ name: bank.name, code: bank.code }))

      this.banksCache = { fetchedAt: Date.now(), banks }
      return banks
    } catch (error: unknown) {
      if (error instanceof ErrorResponse) {
        throw error
      }

      throw new ErrorResponse(`Could not fetch bank list: ${this.getPaystackErrorMessage(error)}`, 502)
    }
  }

  async resolveAccount(input: {
    accountNumber: string
    bankCode: string
  }): Promise<{ accountName: string; accountNumber: string }> {
    try {
      const response = await this.client.get<{
        status: boolean
        message: string
        data: { account_number: string; account_name: string }
      }>('/bank/resolve', {
        params: { account_number: input.accountNumber, bank_code: input.bankCode },
      })

      if (!response.data.status) {
        throw new ErrorResponse(response.data.message || 'Could not resolve this account', 400)
      }

      return {
        accountName: response.data.data.account_name,
        accountNumber: response.data.data.account_number,
      }
    } catch (error: unknown) {
      if (error instanceof ErrorResponse) {
        throw error
      }

      throw new ErrorResponse(`Could not resolve account: ${this.getPaystackErrorMessage(error)}`, 502)
    }
  }

  validateWebhookSignature(
    payload: unknown,
    signature: string | undefined,
  ): boolean {
    if (!signature) {
      return false
    }

    const expectedSignature = createHmac(
      'sha512',
      env.PAYSTACK_SECRET_KEY,
    )
      .update(JSON.stringify(payload))
      .digest('hex')

    const receivedBuffer = Buffer.from(signature, 'hex')
    const expectedBuffer = Buffer.from(expectedSignature, 'hex')

    if (receivedBuffer.length !== expectedBuffer.length) {
      return false
    }

    return timingSafeEqual(receivedBuffer, expectedBuffer)
  }
}

export const paystackService = new PaystackService()