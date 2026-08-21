import { createHmac } from 'crypto'
import axios, {
  AxiosInstance,
} from 'axios'
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { env } from '../config/keys.js'
import {
  PaystackService,
  paystackService,
} from './paystack.service.js'

const postMock = vi.fn()
const getMock = vi.fn()

const mockedClient = {
  post: postMock,
  get: getMock,
} as unknown as AxiosInstance

vi.spyOn(
  axios,
  'create',
).mockReturnValue(mockedClient)

describe(
  'PaystackService.validateWebhookSignature',
  () => {
    it('accepts a valid signature for the exact raw body', () => {
      const rawBody = Buffer.from(
        JSON.stringify({
          event: 'charge.success',
          data: {
            reference:
              'eventra-test-reference',
          },
        }),
      )

      const signature = createHmac(
        'sha512',
        env.PAYSTACK_SECRET_KEY,
      )
        .update(rawBody)
        .digest('hex')

      expect(
        paystackService
          .validateWebhookSignature(
            rawBody,
            signature,
          ),
      ).toBe(true)
    })

    it('rejects a signature when the raw body changes', () => {
      const originalBody = Buffer.from(
        JSON.stringify({
          event: 'charge.success',
          data: {
            reference:
              'eventra-test-reference',
          },
        }),
      )

      const signature = createHmac(
        'sha512',
        env.PAYSTACK_SECRET_KEY,
      )
        .update(originalBody)
        .digest('hex')

      const alteredBody = Buffer.from(
        JSON.stringify({
          event: 'charge.success',
          data: {
            reference:
              'altered-reference',
          },
        }),
      )

      expect(
        paystackService
          .validateWebhookSignature(
            alteredBody,
            signature,
          ),
      ).toBe(false)
    })

    it('rejects missing body or signature', () => {
      const rawBody = Buffer.from('{}')

      expect(
        paystackService
          .validateWebhookSignature(
            undefined,
            'abc',
          ),
      ).toBe(false)

      expect(
        paystackService
          .validateWebhookSignature(
            rawBody,
            undefined,
          ),
      ).toBe(false)
    })
  },
)

describe('PaystackService transfers', () => {
  let service: PaystackService

  beforeEach(() => {
    postMock.mockReset()
    getMock.mockReset()
    service = new PaystackService()
  })

  it('creates a Nigerian bank transfer recipient', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        status: true,
        message:
          'Transfer recipient created successfully',
        data: {
          active: true,
          currency: 'NGN',
          recipient_code:
            'RCP_test_recipient',
          details: {
            account_name:
              'Test Organizer',
            account_number:
              '0123456789',
            bank_code: '058',
            bank_name:
              'Guaranty Trust Bank',
          },
        },
      },
    })

    const recipient =
      await service.createTransferRecipient({
        name: 'Test Organizer',
        accountNumber: '0123456789',
        bankCode: '058',
        metadata: {
          organizerId:
            'test-organizer-id',
        },
      })

    expect(postMock).toHaveBeenCalledWith(
      '/transferrecipient',
      {
        type: 'nuban',
        name: 'Test Organizer',
        account_number: '0123456789',
        bank_code: '058',
        currency: 'NGN',
        metadata: {
          organizerId:
            'test-organizer-id',
        },
      },
    )

    expect(recipient.recipientCode).toBe(
      'RCP_test_recipient',
    )
    expect(recipient.bankName).toBe(
      'Guaranty Trust Bank',
    )
  })

  it('converts Naira to kobo when initiating a transfer', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        status: true,
        message:
          'Transfer has been queued',
        data: {
          amount: 950000,
          currency: 'NGN',
          reference:
            'eventra-payout-1234567890',
          reason:
            'Eventra organizer payout',
          status: 'pending',
          transfer_code:
            'TRF_test_transfer',
          transferred_at: null,
        },
      },
    })

    const transfer =
      await service.initiateTransfer({
        amountNaira: 9500,
        recipientCode:
          'RCP_test_recipient',
        reference:
          'eventra-payout-1234567890',
      })

    expect(postMock).toHaveBeenCalledWith(
      '/transfer',
      {
        source: 'balance',
        amount: 950000,
        recipient:
          'RCP_test_recipient',
        reference:
          'eventra-payout-1234567890',
        reason:
          'Eventra organizer payout',
        currency: 'NGN',
      },
    )

    expect(transfer.amountKobo).toBe(
      950000,
    )
    expect(transfer.status).toBe(
      'pending',
    )
  })

  it('rejects an invalid transfer reference before making a request', async () => {
    await expect(
      service.initiateTransfer({
        amountNaira: 9500,
        recipientCode:
          'RCP_test_recipient',
        reference: 'INVALID!',
      }),
    ).rejects.toThrow(
      /transfer reference must be 16 to 50 characters/i,
    )

    expect(postMock).not.toHaveBeenCalled()
  })

  it('verifies a transfer by its reference', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        status: true,
        message: 'Transfer retrieved',
        data: {
          amount: 950000,
          currency: 'NGN',
          reference:
            'eventra-payout-1234567890',
          reason:
            'Eventra organizer payout',
          status: 'success',
          transfer_code:
            'TRF_test_transfer',
          transferred_at:
            '2026-08-18T10:00:00.000Z',
        },
      },
    })

    const transfer =
      await service.verifyTransfer(
        'eventra-payout-1234567890',
      )

    expect(getMock).toHaveBeenCalledWith(
      '/transfer/verify/eventra-payout-1234567890',
    )

    expect(transfer.status).toBe(
      'success',
    )
    expect(transfer.transferCode).toBe(
      'TRF_test_transfer',
    )
  })
})

describe('PaystackService refunds', () => {
  beforeEach(() => {
    postMock.mockReset()
    getMock.mockReset()
  })

  it('converts the requested Naira amount to kobo', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        status: true,
        message: 'Refund queued',
        data: {
          refund_reference: 'REF_test_refund',
          status: 'pending',
        },
      },
    })

    const service = new PaystackService()
    const refund = await service.refundTransaction({
      transactionReference: 'ORDER-payment-reference',
      amountNaira: 5000,
      reason: 'Approved attendee refund',
    })

    expect(postMock).toHaveBeenCalledWith('/refund', {
      transaction: 'ORDER-payment-reference',
      amount: 500000,
      customer_note: 'Approved attendee refund',
      merchant_note: 'Approved attendee refund',
    })
    expect(refund).toEqual({
      reference: 'REF_test_refund',
      status: 'pending',
    })
  })
})
