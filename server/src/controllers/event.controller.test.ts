import type {
  NextFunction,
  Request,
  Response,
} from 'express'
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
import TicketType from '../models/ticketType.js'
import {
  duplicateEvent,
  getSpotlightEvents,
} from './event.controller.js'

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
        dbName:
          'eventra_event_controller_test',
      },
    )

    await Promise.all([
      Event.init(),
      TicketType.init(),
    ])
  },
  60_000,
)

afterEach(async () => {
  vi.restoreAllMocks()

  await Promise.all([
    TicketType.deleteMany({}),
    Event.deleteMany({}),
  ])
})

afterAll(async () => {
  await mongoose.disconnect()
  await replSet.stop()
})

const invokeController = async (
  handler: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => Promise<void>,
  request: Partial<Request>,
) => {
  let statusCode:
    | number
    | undefined

  let responseBody: unknown

  const response = {
    status: vi.fn(
      (status: number) => {
        statusCode = status
        return response
      },
    ),
    json: vi.fn(
      (body: unknown) => {
        responseBody = body
        return response
      },
    ),
  } as unknown as Response

  const next = vi.fn()

  await handler(
    request as Request,
    response,
    next,
  )

  return {
    statusCode,
    responseBody,
    next,
  }
}

const createSourceEvent =
  async (
    organizerId:
      mongoose.Types.ObjectId,
  ) =>
    Event.create({
      organizer: organizerId,
      title: 'Original Event',
      slug:
        `original-${new mongoose.Types.ObjectId()}`,
      description:
        'An original paid event used for duplication testing',
      category:
        new mongoose.Types.ObjectId(),
      type: 'paid',
      coverImage:
        'https://example.com/original.jpg',
      venue: {
        name: 'Original Hall',
        address: '1 Original Street',
        city: 'Lagos',
      },
      startDate: new Date(
        '2026-09-20T10:00:00.000Z',
      ),
      endDate: new Date(
        '2026-09-20T17:00:00.000Z',
      ),
      capacity: 100,
      refundPolicy: {
        type:
          'refund-until-days-before',
        daysBefore: 3,
      },
      status: 'approved',
      isPromoted: true,
      promotion: {
        package: 'featured-7d',
        status: 'approved',
        startsAt: new Date(
          '2026-08-20T00:00:00.000Z',
        ),
        endsAt: new Date(
          '2026-08-27T00:00:00.000Z',
        ),
        paidAt: new Date(
          '2026-08-19T12:00:00.000Z',
        ),
        paystackReference:
          `PROMO-${new mongoose.Types.ObjectId()}`,
      },
      reservationsCount: 4,
      ticketsSoldCount: 10,
      revenueTotal: 50000,
      minPrice: 5000,
      publishedAt: new Date(
        '2026-08-10T12:00:00.000Z',
      ),
    })

const createSpotlightEvent =
  async (
    startsAt: Date,
    endsAt: Date,
    title: string,
  ) =>
    Event.create({
      organizer:
        new mongoose.Types.ObjectId(),
      title,
      slug:
        `spotlight-${new mongoose.Types.ObjectId()}`,
      description:
        'An event used to test spotlight visibility rules',
      category:
        new mongoose.Types.ObjectId(),
      type: 'free',
      coverImage:
        'https://example.com/spotlight.jpg',
      venue: {
        name: 'Spotlight Hall',
        address: '2 Spotlight Street',
        city: 'Lagos',
      },
      startDate: new Date(
        '2026-09-30T10:00:00.000Z',
      ),
      status: 'approved',
      isPromoted: true,
      promotion: {
        package: 'featured-7d',
        status: 'approved',
        startsAt,
        endsAt,
        paidAt: new Date(
          '2026-08-18T12:00:00.000Z',
        ),
        paystackReference:
          `PROMO-${new mongoose.Types.ObjectId()}`,
      },
    })

describe(
  'duplicateEvent',
  () => {
    it('creates a valid draft and resets sales and promotion state', async () => {
      const organizerId =
        new mongoose.Types.ObjectId()

      const source =
        await createSourceEvent(
          organizerId,
        )

      await TicketType.create([
        {
          event: source._id,
          name: 'Regular',
          price: 5000,
          quantity: 80,
          quantitySold: 10,
          quantityReserved: 3,
          purchaseLimitPerPerson:
            4,
          isActive: true,
        },
        {
          event: source._id,
          name: 'VIP',
          price: 15000,
          quantity: 20,
          quantitySold: 2,
          quantityReserved: 1,
          purchaseLimitPerPerson:
            2,
          isActive: true,
        },
      ])

      const result =
        await invokeController(
          duplicateEvent,
          {
            params: {
              id:
                source._id.toString(),
            },
            session: {
              userId:
                organizerId.toString(),
              role: 'organizer',
            },
          } as Partial<Request>,
        )

      expect(result.next).not
        .toHaveBeenCalled()

      expect(result.statusCode).toBe(
        201,
      )

      const response =
        result.responseBody as {
          body: {
            _id:
              mongoose.Types.ObjectId
          }
        }

      const duplicate =
        await Event.findById(
          response.body._id,
        ).lean()

      expect(duplicate).not.toBeNull()
      expect(duplicate!.status).toBe(
        'draft',
      )
      expect(
        duplicate!.startDate,
      ).toEqual(source.startDate)
      expect(duplicate!.endDate).toEqual(
        source.endDate,
      )
      expect(
        duplicate!.reservationsCount,
      ).toBe(0)
      expect(
        duplicate!.ticketsSoldCount,
      ).toBe(0)
      expect(
        duplicate!.revenueTotal,
      ).toBe(0)
      expect(
        duplicate!.isPromoted,
      ).toBe(false)
      expect(
        duplicate!.promotion,
      ).toBeUndefined()
      expect(
        duplicate!.publishedAt,
      ).toBeUndefined()
      expect(duplicate!.minPrice).toBe(
        5000,
      )

      const duplicatedTypes =
        await TicketType.find({
          event: duplicate!._id,
        })
          .sort({ price: 1 })
          .lean()

      expect(
        duplicatedTypes,
      ).toHaveLength(2)

      expect(
        duplicatedTypes.map(
          ticketType =>
            ticketType.quantitySold,
        ),
      ).toEqual([0, 0])

      expect(
        duplicatedTypes.map(
          ticketType =>
            ticketType.quantityReserved,
        ),
      ).toEqual([0, 0])
    })

    it('rolls back the new event if ticket-type cloning fails', async () => {
      const organizerId =
        new mongoose.Types.ObjectId()

      const source =
        await createSourceEvent(
          organizerId,
        )

      await TicketType.create({
        event: source._id,
        name: 'Regular',
        price: 5000,
        quantity: 50,
        isActive: true,
      })

      vi.spyOn(
        TicketType,
        'insertMany',
      ).mockRejectedValueOnce(
        new Error(
          'Simulated ticket clone failure',
        ),
      )

      const result =
        await invokeController(
          duplicateEvent,
          {
            params: {
              id:
                source._id.toString(),
            },
            session: {
              userId:
                organizerId.toString(),
              role: 'organizer',
            },
          } as Partial<Request>,
        )

      expect(
        result.next,
      ).toHaveBeenCalledWith(
        expect.any(Error),
      )

      expect(
        await Event.countDocuments({
          organizer: organizerId,
        }),
      ).toBe(1)
    })
  },
)

describe(
  'getSpotlightEvents',
  () => {
    it('returns only promotions active at the current time', async () => {
      const now = new Date()

      const active =
        await createSpotlightEvent(
          new Date(
            now.getTime() -
              60 * 60 * 1000,
          ),
          new Date(
            now.getTime() +
              60 * 60 * 1000,
          ),
          'Active Promotion',
        )

      await createSpotlightEvent(
        new Date(
          now.getTime() -
            2 * 60 * 60 * 1000,
        ),
        new Date(
          now.getTime() -
            60 * 60 * 1000,
        ),
        'Expired Promotion',
      )

      await createSpotlightEvent(
        new Date(
          now.getTime() +
            60 * 60 * 1000,
        ),
        new Date(
          now.getTime() +
            2 * 60 * 60 * 1000,
        ),
        'Upcoming Promotion',
      )

      const result =
        await invokeController(
          getSpotlightEvents,
          {
            query: {},
          },
        )

      expect(result.statusCode).toBe(
        200,
      )

      const response =
        result.responseBody as {
          body: {
            events: Array<{
              _id:
                mongoose.Types.ObjectId
            }>
          }
        }

      expect(
        response.body.events,
      ).toHaveLength(1)

      expect(
        response.body.events[0]._id
          .toString(),
      ).toBe(active._id.toString())
    })

    it('uses the default limit for a negative limit query', async () => {
      const now = new Date()

      await Promise.all(
        Array.from(
          { length: 9 },
          (_, index) =>
            createSpotlightEvent(
              new Date(
                now.getTime() -
                  60 * 60 * 1000,
              ),
              new Date(
                now.getTime() +
                  60 * 60 * 1000,
              ),
              `Promotion ${index}`,
            ),
        ),
      )

      const result =
        await invokeController(
          getSpotlightEvents,
          {
            query: {
              limit: '-5',
            },
          },
        )

      const response =
        result.responseBody as {
          body: {
            events: unknown[]
          }
        }

      expect(
        response.body.events,
      ).toHaveLength(8)
    })
  },
)