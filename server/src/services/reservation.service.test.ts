import mongoose from 'mongoose'
import {
  MongoMemoryReplSet,
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
import Ticket from '../models/ticket.js'
import {
  ReservationService,
} from './reservation.service.js'

vi.mock('./email.service.js', () => ({
  EmailService: {
    sendTicketConfirmationEmail:
      vi.fn().mockResolvedValue({
        success: true,
      }),
  },
}))

let replSet: MongoMemoryReplSet

beforeAll(
  async () => {
    replSet =
      await MongoMemoryReplSet.create({
        replSet: {
          count: 1,
          storageEngine: 'wiredTiger',
        },
        binary: {
          version: '7.0.14',
        },
      })

    await mongoose.connect(
      replSet.getUri(),
      {
        dbName: 'eventra_reservation_test',
      },
    )

    await Promise.all([
      Event.init(),
      Order.init(),
      Ticket.init(),
    ])
  },
  60_000,
)

afterEach(async () => {
  await Promise.all([
    Ticket.deleteMany({}),
    Order.deleteMany({}),
    Event.deleteMany({}),
  ])

  vi.clearAllMocks()
})

afterAll(async () => {
  await mongoose.disconnect()
  await replSet.stop()
})

const createFreeEvent = async (
  capacity: number,
) =>
  Event.create({
    organizer:
      new mongoose.Types.ObjectId(),
    title: 'Free Test Event',
    slug:
      `free-test-${new mongoose.Types.ObjectId()}`,
    description:
      'A free event used for reservation testing',
    category:
      new mongoose.Types.ObjectId(),
    type: 'free',
    coverImage:
      'https://example.com/free-event.jpg',
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
    capacity,
  })

const createReservationInput = (
  eventId: mongoose.Types.ObjectId,
  email: string,
  quantity = 1,
) => ({
  eventId: eventId.toString(),
  buyerId:
    new mongoose.Types.ObjectId()
      .toString(),
  customer: {
    fullname: 'Test Attendee',
    email,
    phone: '08000000000',
  },
  quantity,
})

describe(
  'ReservationService.createReservation',
  () => {
    it('creates a confirmed order, issues a ticket and increments capacity usage', async () => {
      const event =
        await createFreeEvent(2)

      const service =
        new ReservationService()

      const result =
        await service.createReservation(
          createReservationInput(
            event._id,
            'first@example.com',
          ),
        )

      expect(result.status).toBe(
        'confirmed',
      )
      expect(result.quantity).toBe(1)
      expect(
        result.ticketCodes,
      ).toHaveLength(1)

      const updatedEvent =
        await Event.findById(
          event._id,
        ).lean()

      expect(
        updatedEvent!
          .reservationsCount,
      ).toBe(1)

      const order =
        await Order.findById(
          result.orderId,
        ).lean()

      expect(order!.status).toBe(
        'confirmed',
      )
      expect(order!.type).toBe('free')

      const tickets =
        await Ticket.find({
          order: order!._id,
        }).lean()

      expect(tickets).toHaveLength(1)
      expect(tickets[0].status).toBe(
        'active',
      )
    })

    it('issues one ticket per reserved guest', async () => {
      const event =
        await createFreeEvent(10)

      const service =
        new ReservationService()

      const result =
        await service.createReservation(
          createReservationInput(
            event._id,
            'group@example.com',
            3,
          ),
        )

      expect(result.quantity).toBe(3)

      expect(
        result.ticketCodes,
      ).toHaveLength(3)

      expect(
        new Set(
          result.ticketCodes,
        ).size,
      ).toBe(3)

      const updatedEvent =
        await Event.findById(
          event._id,
        ).lean()

      expect(
        updatedEvent!
          .reservationsCount,
      ).toBe(3)

      expect(
        await Ticket.countDocuments({
          event: event._id,
          status: 'active',
        }),
      ).toBe(3)
    })

    it('rejects a reservation when the event has insufficient capacity', async () => {
      const event =
        await createFreeEvent(1)

      const service =
        new ReservationService()

      await service.createReservation(
        createReservationInput(
          event._id,
          'first@example.com',
        ),
      )

      await expect(
        service.createReservation(
          createReservationInput(
            event._id,
            'second@example.com',
          ),
        ),
      ).rejects.toThrow(
        /enough available spaces/i,
      )

      const updatedEvent =
        await Event.findById(
          event._id,
        ).lean()

      expect(
        updatedEvent!
          .reservationsCount,
      ).toBe(1)

      expect(
        await Ticket.countDocuments({
          event: event._id,
        }),
      ).toBe(1)
    })

    it('never exceeds event capacity under concurrent reservations', async () => {
      const event =
        await createFreeEvent(3)

      const service =
        new ReservationService()

      const results =
        await Promise.allSettled(
          Array.from(
            { length: 10 },
            (_, index) =>
              service.createReservation(
                createReservationInput(
                  event._id,
                  `attendee-${index}@example.com`,
                ),
              ),
          ),
        )

      const succeeded =
        results.filter(
          result =>
            result.status ===
            'fulfilled',
        )

      const failed =
        results.filter(
          result =>
            result.status ===
            'rejected',
        )

      expect(succeeded).toHaveLength(3)
      expect(failed).toHaveLength(7)

      const updatedEvent =
        await Event.findById(
          event._id,
        ).lean()

      expect(
        updatedEvent!
          .reservationsCount,
      ).toBe(3)

      expect(
        await Order.countDocuments({
          event: event._id,
          status: 'confirmed',
        }),
      ).toBe(3)

      expect(
        await Ticket.countDocuments({
          event: event._id,
          status: 'active',
        }),
      ).toBe(3)
    })
  },
)