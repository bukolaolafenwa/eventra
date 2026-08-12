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