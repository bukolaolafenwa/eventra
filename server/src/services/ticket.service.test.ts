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
} from 'vitest'

import Order from '../models/order.js'
import Ticket from '../models/ticket.js'
import {
  TicketService,
} from './ticket.service.js'

let mongoServer: MongoMemoryServer

beforeAll(async () => {
  mongoServer =
    await MongoMemoryServer.create()

  await mongoose.connect(
    mongoServer.getUri(),
  )

  await Promise.all([
    Order.init(),
    Ticket.init(),
  ])
})

afterEach(async () => {
  await Promise.all([
    Ticket.deleteMany({}),
    Order.deleteMany({}),
  ])
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongoServer.stop()
})

const createPaidOrder = async (
  quantity = 2,
  status:
    | 'pending'
    | 'paid'
    | 'confirmed' = 'paid',
) => {
  const unitPrice = 5000
  const subtotal =
    unitPrice * quantity

  return Order.create({
    orderNumber:
      `EVT-${new mongoose.Types.ObjectId()}`,
    buyer:
      new mongoose.Types.ObjectId(),
    event:
      new mongoose.Types.ObjectId(),
    customer: {
      fullname: 'Test Attendee',
      email: 'attendee@example.com',
      phone: '08000000000',
    },
    items: [
      {
        ticketType:
          new mongoose.Types.ObjectId(),
        ticketTypeName: 'Regular',
        unitPrice,
        quantity,
        subtotal,
      },
    ],
    type: 'paid',
    subtotal,
    serviceFee:
      Math.round(subtotal * 0.05),
    totalAmount: subtotal,
    currency: 'NGN',
    paymentProvider: 'paystack',
    status,
    paystackReference:
      `payment-${new mongoose.Types.ObjectId()}`,
    refundedAmount: 0,
    paidAt:
      status === 'paid'
        ? new Date()
        : undefined,
    confirmedAt:
      status === 'confirmed'
        ? new Date()
        : undefined,
  })
}

describe(
  'TicketService.issueTicketsForOrder',
  () => {
    it('issues one active ticket for every admission in a paid order', async () => {
      const order =
        await createPaidOrder(2)

      const service =
        new TicketService()

      const tickets =
        (await service
          .issueTicketsForOrder(
            order._id.toString(),
          )) as Array<{
          order: mongoose.Types.ObjectId
          sequence: number
          code: string
          status: string
          pricePaid: number
        }>

      expect(tickets).toHaveLength(2)

      expect(
        tickets.map(
          ticket => ticket.sequence,
        ),
      ).toEqual([1, 2])

      expect(
        new Set(
          tickets.map(
            ticket => ticket.code,
          ),
        ).size,
      ).toBe(2)

      tickets.forEach(ticket => {
        expect(ticket.status).toBe(
          'active',
        )
        expect(ticket.pricePaid).toBe(
          5000,
        )
        expect(
          ticket.order.toString(),
        ).toBe(order._id.toString())
      })
    })

    it('is idempotent when called repeatedly for the same order', async () => {
      const order =
        await createPaidOrder(2)

      const service =
        new TicketService()

      const firstResult =
        await service
          .issueTicketsForOrder(
            order._id.toString(),
          )

      const secondResult =
        await service
          .issueTicketsForOrder(
            order._id.toString(),
          )

      expect(firstResult).toHaveLength(2)
      expect(secondResult).toHaveLength(
        2,
      )

      expect(
        await Ticket.countDocuments({
          order: order._id,
        }),
      ).toBe(2)
    })

    it('does not create duplicate tickets under concurrent calls', async () => {
      const order =
        await createPaidOrder(2)

      const service =
        new TicketService()

      const results =
        await Promise.all([
          service.issueTicketsForOrder(
            order._id.toString(),
          ),
          service.issueTicketsForOrder(
            order._id.toString(),
          ),
        ])

      expect(results[0]).toHaveLength(2)
      expect(results[1]).toHaveLength(2)

      expect(
        await Ticket.countDocuments({
          order: order._id,
        }),
      ).toBe(2)
    })

    it('rejects an order that has not been paid or confirmed', async () => {
      const order =
        await createPaidOrder(
          1,
          'pending',
        )

      const service =
        new TicketService()

      await expect(
        service.issueTicketsForOrder(
          order._id.toString(),
        ),
      ).rejects.toThrow(
        /paid or confirmed order/i,
      )

      expect(
        await Ticket.countDocuments({
          order: order._id,
        }),
      ).toBe(0)
    })
  },
)