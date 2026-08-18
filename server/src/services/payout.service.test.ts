import mongoose from 'mongoose'
import {
  MongoMemoryServer,
} from 'mongodb-memory-server'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import Event from '../models/event.js'
import Order from '../models/order.js'
import Payout from '../models/payout.js'
import User from '../models/user.js'
import { PaystackTransferRejectedError, paystackService } from './paystack.service.js'
import {
  PayoutService,
} from './payout.service.js'

let mongoServer: MongoMemoryServer

const initiateTransferMock =
  vi.spyOn(
    paystackService,
    'initiateTransfer',
  )

const NOW = new Date(
  '2026-08-18T12:00:00.000Z',
)

const createOrganizer = async () =>
  User.create({
    fullname: 'Test Organizer',
    email: `organizer-${new mongoose.Types.ObjectId()}@example.com`,
    password: 'password123',
    phone: '08000000000',
    role: 'organizer',
    isVerified: true,
    organizerProfile: {
      businessName:
        'Test Events Limited',
      approvalStatus: 'approved',
      bankName:
        'Guaranty Trust Bank',
      bankCode: '058',
      accountNumber: '0123454321',
      accountName:
        'Test Organizer',
      isPayoutReady: true,
      paystackRecipientCode:
        'RCP_test_recipient',
    },
  })

const createPaidEvent = async (
  organizerId: mongoose.Types.ObjectId,
  endDate: Date,
) =>
  Event.create({
    organizer: organizerId,
    title: 'Test Paid Event',
    slug: `test-paid-event-${new mongoose.Types.ObjectId()}`,
    description:
      'A paid event used for payout testing',
    category:
      new mongoose.Types.ObjectId(),
    type: 'paid',
    coverImage:
      'https://example.com/event.jpg',
    venue: {
      name: 'Test Hall',
      address: '1 Test Street',
      city: 'Lagos',
    },
    startDate: new Date(
      endDate.getTime() -
        2 * 60 * 60 * 1000,
    ),
    endDate,
    refundPolicy: {
      type: 'no-refunds',
    },
    status: 'approved',
  })

const createPaidOrder = async (
  eventId: mongoose.Types.ObjectId,
) =>
  Order.create({
    orderNumber:
      `EVT-${new mongoose.Types.ObjectId()}`,
    event: eventId,
    customer: {
      fullname: 'Test Attendee',
      email: 'attendee@example.com',
    },
    items: [
      {
        ticketTypeName: 'Regular',
        unitPrice: 10000,
        quantity: 1,
        subtotal: 10000,
      },
    ],
    type: 'paid',
    subtotal: 10000,
    serviceFee: 500,
    totalAmount: 10000,
    currency: 'NGN',
    paymentProvider: 'paystack',
    status: 'paid',
    paystackReference:
      `payment-${new mongoose.Types.ObjectId()}`,
    refundedAmount: 0,
    paidAt: new Date(
      '2026-08-10T12:00:00.000Z',
    ),
  })

const createProcessingPayout =
  async () => {
    initiateTransferMock
      .mockResolvedValueOnce({
        reference:
          'eventra-payout-test-reference',
        transferCode:
          'TRF_test_transfer',
        status: 'pending',
        amountKobo: 950000,
        currency: 'NGN',
      })

    const organizer =
      await createOrganizer()

    const event =
      await createPaidEvent(
        organizer._id,
        new Date(
          '2026-08-14T12:00:00.000Z',
        ),
      )

    await createPaidOrder(event._id)

    const service =
      new PayoutService()

    const initiated =
      await service.initiateEventPayout(
        event._id.toString(),
        new mongoose.Types.ObjectId()
          .toString(),
        NOW,
      )

    return {
      service,
      initiated,
    }
  }

describe(
  'PayoutService.initiateEventPayout',
  () => {
    beforeAll(async () => {
      mongoServer =
        await MongoMemoryServer.create()

      await mongoose.connect(
        mongoServer.getUri(),
      )

      await Promise.all([
        Event.init(),
        Order.init(),
        Payout.init(),
        User.init(),
      ])
    })

    afterEach(async () => {
      await Promise.all([
        Event.deleteMany({}),
        Order.deleteMany({}),
        Payout.deleteMany({}),
        User.deleteMany({}),
      ])

      initiateTransferMock.mockReset()
    })

    afterAll(async () => {
      await mongoose.disconnect()
      await mongoServer.stop()
    })

    it('creates and initiates an eligible event payout', async () => {
      initiateTransferMock
        .mockResolvedValueOnce({
          reference:
            'eventra-payout-test-reference',
          transferCode:
            'TRF_test_transfer',
          status: 'pending',
          amountKobo: 950000,
          currency: 'NGN',
        })

      const organizer =
        await createOrganizer()

      const event =
        await createPaidEvent(
          organizer._id,
          new Date(
            '2026-08-14T12:00:00.000Z',
          ),
        )

      const order =
        await createPaidOrder(
          event._id,
        )

      const service =
        new PayoutService()

      const result =
        await service.initiateEventPayout(
          event._id.toString(),
          new mongoose.Types.ObjectId()
            .toString(),
          NOW,
        )

      expect(result.grossAmount).toBe(
        10000,
      )
      expect(
        result.commissionAmount,
      ).toBe(500)
      expect(result.netAmount).toBe(
        9500,
      )
      expect(result.status).toBe(
        'processing',
      )

      expect(
        initiateTransferMock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          amountNaira: 9500,
          recipientCode:
            'RCP_test_recipient',
        }),
      )

      const payout =
        await Payout.findById(
          result.payoutId,
        ).lean()

      expect(payout).not.toBeNull()
      expect(payout!.orders).toEqual([
        order._id,
      ])
      expect(
        payout!.destination
          .accountNumberLast4,
      ).toBe('4321')
      expect(payout!.transferCode).toBe(
        'TRF_test_transfer',
      )
    })

    it('rejects payout before the three-day hold ends', async () => {
      const organizer =
        await createOrganizer()

      const event =
        await createPaidEvent(
          organizer._id,
          new Date(
            '2026-08-16T12:00:00.000Z',
          ),
        )

      await createPaidOrder(event._id)

      const service =
        new PayoutService()

      await expect(
        service.initiateEventPayout(
          event._id.toString(),
          new mongoose.Types.ObjectId()
            .toString(),
          NOW,
        ),
      ).rejects.toThrow(
        /held until/i,
      )

      expect(
        initiateTransferMock,
      ).not.toHaveBeenCalled()

      expect(
        await Payout.countDocuments(),
      ).toBe(0)
    })

    it('prevents a second payout for the same event', async () => {
      initiateTransferMock
        .mockResolvedValue({
          reference:
            'eventra-payout-test-reference',
          transferCode:
            'TRF_test_transfer',
          status: 'pending',
          amountKobo: 950000,
          currency: 'NGN',
        })

      const organizer =
        await createOrganizer()

      const event =
        await createPaidEvent(
          organizer._id,
          new Date(
            '2026-08-14T12:00:00.000Z',
          ),
        )

      await createPaidOrder(event._id)

      const service =
        new PayoutService()

      const adminId =
        new mongoose.Types.ObjectId()
          .toString()

      await service.initiateEventPayout(
        event._id.toString(),
        adminId,
        NOW,
      )

      await expect(
        service.initiateEventPayout(
          event._id.toString(),
          adminId,
          NOW,
        ),
      ).rejects.toThrow(
        /payout record already exists/i,
      )

      expect(
        initiateTransferMock,
      ).toHaveBeenCalledTimes(1)

      expect(
        await Payout.countDocuments(),
      ).toBe(1)
    })

        it('marks a successful Paystack transfer as paid', async () => {
      const {
      service,
      initiated: result,
        } =
        await createProcessingPayout()

      const reconciled =
        await service
          .reconcileTransferWebhook(
            'transfer.success',
            {
              reference:
                result.reference,
              transfer_code:
                'TRF_test_transfer',
              status: 'success',
              amount: 950000,
              currency: 'NGN',
              transferred_at:
                '2026-08-18T12:05:00.000Z',
            },
            NOW,
          )

      expect(reconciled.processed).toBe(
        true,
      )
      expect(reconciled.status).toBe(
        'paid',
      )

      const payout =
        await Payout.findById(
          result.payoutId,
        ).lean()

      expect(payout!.status).toBe(
        'paid',
      )
      expect(
        payout!.paidAt?.toISOString(),
      ).toBe(
        '2026-08-18T12:05:00.000Z',
      )
    })

    it('handles a repeated success webhook idempotently', async () => {
        const {
        service,
        initiated: result,
        } =
    await createProcessingPayout()

      const webhookData = {
        reference: result.reference,
        transfer_code:
          'TRF_test_transfer',
        status: 'success',
        amount: 950000,
        currency: 'NGN',
      }

      const first =
        await service
          .reconcileTransferWebhook(
            'transfer.success',
            webhookData,
            NOW,
          )

      const second =
        await service
          .reconcileTransferWebhook(
            'transfer.success',
            webhookData,
            NOW,
          )

      expect(first.processed).toBe(true)
      expect(second.processed).toBe(
        false,
      )
      expect(second.status).toBe(
        'paid',
      )
    })

    it('marks a failed Paystack transfer as failed', async () => {
        const {
        service,
        initiated: result,
        } =
        await createProcessingPayout()

      const reconciled =
        await service
          .reconcileTransferWebhook(
            'transfer.failed',
            {
              reference:
                result.reference,
              transfer_code:
                'TRF_test_transfer',
              status: 'failed',
              amount: 950000,
              currency: 'NGN',
              reason:
                'Recipient bank rejected the transfer',
            },
            NOW,
          )

      expect(reconciled.status).toBe(
        'failed',
      )

      const payout =
        await Payout.findById(
          result.payoutId,
        ).lean()

      expect(
        payout!.failureReason,
      ).toMatch(/recipient bank/i)
      expect(payout!.failedAt).toEqual(
        NOW,
      )
    })

    it('moves a paid payout to reversed when Paystack reverses it', async () => {
        const {
        service,
        initiated: result,
      } =
    await createProcessingPayout()

      await service
        .reconcileTransferWebhook(
          'transfer.success',
          {
            reference:
              result.reference,
            transfer_code:
              'TRF_test_transfer',
            status: 'success',
            amount: 950000,
            currency: 'NGN',
          },
          NOW,
        )

      const reversed =
        await service
          .reconcileTransferWebhook(
            'transfer.reversed',
            {
              reference:
                result.reference,
              transfer_code:
                'TRF_test_transfer',
              status: 'reversed',
              amount: 950000,
              currency: 'NGN',
              reason:
                'Transfer was returned',
            },
            NOW,
          )

      expect(reversed.processed).toBe(
        true,
      )
      expect(reversed.status).toBe(
        'reversed',
      )

      const payout =
        await Payout.findById(
          result.payoutId,
        ).lean()

      expect(payout!.reversedAt).toEqual(
        NOW,
      )
    })

    it('rejects a transfer webhook with the wrong amount', async () => {
        const {
        service,
        initiated: result,
        } =
    await createProcessingPayout()

      await expect(
        service.reconcileTransferWebhook(
          'transfer.success',
          {
            reference:
              result.reference,
            transfer_code:
              'TRF_test_transfer',
            status: 'success',
            amount: 900000,
            currency: 'NGN',
          },
          NOW,
        ),
      ).rejects.toThrow(
        /amount does not match/i,
      )

      const payout =
        await Payout.findById(
          result.payoutId,
        ).lean()

      expect(payout!.status).toBe(
        'processing',
      )
    })

    it('rejects a transfer webhook with the wrong transfer code', async () => {
        const {
        service,
        initiated: result,
        } =
    await createProcessingPayout()

      await expect(
        service.reconcileTransferWebhook(
          'transfer.success',
          {
            reference:
              result.reference,
            transfer_code:
              'TRF_wrong_transfer',
            status: 'success',
            amount: 950000,
            currency: 'NGN',
          },
          NOW,
        ),
      ).rejects.toThrow(
        /transfer code does not match/i,
      )

      const payout =
        await Payout.findById(
          result.payoutId,
        ).lean()

      expect(payout!.status).toBe(
        'processing',
      )
    })

        it('marks an explicit Paystack initiation rejection as failed', async () => {
      initiateTransferMock
        .mockRejectedValueOnce(
          new PaystackTransferRejectedError(
            'Third-party payouts are unavailable for starter businesses',
            502,
          ),
        )

      const organizer =
        await createOrganizer()

      const event =
        await createPaidEvent(
          organizer._id,
          new Date(
            '2026-08-14T12:00:00.000Z',
          ),
        )

      await createPaidOrder(event._id)

      const service =
        new PayoutService()

      await expect(
        service.initiateEventPayout(
          event._id.toString(),
          new mongoose.Types.ObjectId()
            .toString(),
          NOW,
        ),
      ).rejects.toThrow(
        /starter businesses/i,
      )

      const payout =
        await Payout.findOne({
          event: event._id,
        }).lean()

      expect(payout).not.toBeNull()
      expect(payout!.status).toBe(
        'failed',
      )
      expect(
        payout!.providerStatus,
      ).toBe('initiation_rejected')
      expect(payout!.failedAt).toEqual(
        NOW,
      )
    })

    it('keeps an ambiguous transfer timeout pending for reconciliation', async () => {
      initiateTransferMock
        .mockRejectedValueOnce(
          new Error(
            'Connection timed out before a response was received',
          ),
        )

      const organizer =
        await createOrganizer()

      const event =
        await createPaidEvent(
          organizer._id,
          new Date(
            '2026-08-14T12:00:00.000Z',
          ),
        )

      await createPaidOrder(event._id)

      const service =
        new PayoutService()

      await expect(
        service.initiateEventPayout(
          event._id.toString(),
          new mongoose.Types.ObjectId()
            .toString(),
          NOW,
        ),
      ).rejects.toThrow(
        /timed out/i,
      )

      const payout =
        await Payout.findOne({
          event: event._id,
        }).lean()

      expect(payout).not.toBeNull()
      expect(payout!.status).toBe(
        'pending',
      )
      expect(
        payout!.providerStatus,
      ).toBe('initiation_unknown')
      expect(payout!.failedAt).toBe(
        undefined,
      )
    })
  },
)