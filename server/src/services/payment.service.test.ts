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
import {
  PaymentService,
} from './payment.service.js'
import {
  paystackService,
} from './paystack.service.js'

let mongoServer: MongoMemoryServer

const verifyTransactionMock =
  vi.spyOn(
    paystackService,
    'verifyTransaction',
  )

beforeAll(async () => {
  mongoServer =
    await MongoMemoryServer.create()

  await mongoose.connect(
    mongoServer.getUri(),
    {
      dbName:
        'eventra_promotion_payment_test',
    },
  )

  await Event.init()
})

afterEach(async () => {
  await Event.deleteMany({})
  verifyTransactionMock.mockReset()
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongoServer.stop()
})

const createPromotionEvent =
  async (
    reference:
      string = `PROMO-${new mongoose.Types.ObjectId()}`,
  ) =>
    Event.create({
      organizer:
        new mongoose.Types.ObjectId(),
      title: 'Promoted Test Event',
      slug:
        `promoted-test-${new mongoose.Types.ObjectId()}`,
      description:
        'An approved event used to test promotion payment confirmation',
      category:
        new mongoose.Types.ObjectId(),
      type: 'free',
      coverImage:
        'https://example.com/promotion-event.jpg',
      venue: {
        name: 'Test Hall',
        address: '1 Test Street',
        city: 'Lagos',
      },
      startDate: new Date(
        Date.now() +
          7 * 24 * 60 * 60 * 1000,
      ),
      status: 'approved',
      promotion: {
        package: 'featured-7d',
        status: 'pending',
        paystackReference:
          reference,
      },
    })

const verifiedTransactionFor = (
  eventId: string,
  reference: string,
) => ({
  reference,
  status: 'success',
  amountKobo: 1_500_000,
  currency: 'NGN',
  paidAt:
    '2026-08-20T08:00:00.000Z',
  channel: 'card',
  metadata: {
    eventId,
    packageId: 'featured-7d',
  },
})

describe(
  'PaymentService.confirmPromotionPayment',
  () => {
    it('verifies and confirms a matching promotion payment', async () => {
      const event =
        await createPromotionEvent()

      const reference =
        event.promotion!
          .paystackReference!

      verifyTransactionMock
        .mockResolvedValueOnce(
          verifiedTransactionFor(
            event._id.toString(),
            reference,
          ),
        )

      const service =
        new PaymentService()

      const result =
        await service
          .confirmPromotionPayment(
            reference,
          )

      expect(
        verifyTransactionMock,
      ).toHaveBeenCalledWith(
        reference,
        15000,
      )

      expect(
        result.alreadyConfirmed,
      ).toBe(false)

      const updatedEvent =
        await Event.findById(
          event._id,
        ).lean()

      expect(
        updatedEvent!
          .promotion!
          .paidAt,
      ).toEqual(
        new Date(
          '2026-08-20T08:00:00.000Z',
        ),
      )
    })

    it('rejects Paystack metadata belonging to another event', async () => {
      const event =
        await createPromotionEvent()

      const reference =
        event.promotion!
          .paystackReference!

      verifyTransactionMock
        .mockResolvedValueOnce({
          ...verifiedTransactionFor(
            event._id.toString(),
            reference,
          ),
          metadata: {
            eventId:
              new mongoose.Types.ObjectId()
                .toString(),
            packageId:
              'featured-7d',
          },
        })

      const service =
        new PaymentService()

      await expect(
        service
          .confirmPromotionPayment(
            reference,
          ),
      ).rejects.toThrow(
        /metadata does not match/i,
      )

      const unchangedEvent =
        await Event.findById(
          event._id,
        ).lean()

      expect(
        unchangedEvent!
          .promotion!
          .paidAt,
      ).toBeUndefined()
    })

    it('does not reverify an already-confirmed promotion', async () => {
      const event =
        await createPromotionEvent()

      const reference =
        event.promotion!
          .paystackReference!

      verifyTransactionMock
        .mockResolvedValueOnce(
          verifiedTransactionFor(
            event._id.toString(),
            reference,
          ),
        )

      const service =
        new PaymentService()

      const firstResult =
        await service
          .confirmPromotionPayment(
            reference,
          )

      const secondResult =
        await service
          .confirmPromotionPayment(
            reference,
          )

      expect(
        firstResult.alreadyConfirmed,
      ).toBe(false)

      expect(
        secondResult.alreadyConfirmed,
      ).toBe(true)

      expect(
        verifyTransactionMock,
      ).toHaveBeenCalledTimes(1)
    })

    it('confirms only once under concurrent requests', async () => {
      const event =
        await createPromotionEvent()

      const reference =
        event.promotion!
          .paystackReference!

      verifyTransactionMock
        .mockResolvedValue(
          verifiedTransactionFor(
            event._id.toString(),
            reference,
          ),
        )

      const service =
        new PaymentService()

      const results =
        await Promise.all([
          service
            .confirmPromotionPayment(
              reference,
            ),
          service
            .confirmPromotionPayment(
              reference,
            ),
        ])

      expect(
        results.filter(
          result =>
            !result.alreadyConfirmed,
        ),
      ).toHaveLength(1)

      expect(
        results.filter(
          result =>
            result.alreadyConfirmed,
        ),
      ).toHaveLength(1)

      const updatedEvent =
        await Event.findById(
          event._id,
        ).lean()

      expect(
        updatedEvent!
          .promotion!
          .paidAt,
      ).toBeDefined()
    })

    it('enforces unique promotion payment references across events', async () => {
      const reference =
        'PROMO-UNIQUE-REFERENCE'

      await createPromotionEvent(
        reference,
      )

      await expect(
        createPromotionEvent(
          reference,
        ),
      ).rejects.toMatchObject({
        code: 11000,
      })
    })
  },
)