import { randomBytes } from 'crypto'
import mongoose from 'mongoose'

import { env } from '../config/keys.js'
import { ErrorResponse } from '../middlewares/error.middleware.js'
import Event from '../models/event.js'
import Order, {
  IOrder,
  IOrderCustomer,
  IOrderItem,
} from '../models/order.js'
import TicketType, {
  ITicketType,
} from '../models/tickettype.js'
import { paystackService } from './paystack.service.js'

export interface CheckoutItemInput {
  ticketTypeId: string
  quantity: number
}

export interface CreateCheckoutInput {
  eventId: string
  buyerId?: string
  customer: IOrderCustomer
  items: CheckoutItemInput[]
}

export interface CheckoutResult {
  orderId: string
  orderNumber: string
  reference: string
  subtotal: number
  serviceFee: number
  totalAmount: number
  currency: 'NGN'
  authorizationUrl: string
}

interface NormalizedCheckoutItem {
  ticketTypeId: string
  quantity: number
}

export class CheckoutService {
  private readonly serviceFeePercentage = 5

  private readonly reservationMinutes = 15

  private normalizeItems(
    items: CheckoutItemInput[],
  ): NormalizedCheckoutItem[] {
    const quantities = new Map<string, number>()

    for (const item of items) {
      if (!mongoose.Types.ObjectId.isValid(item.ticketTypeId)) {
        throw new ErrorResponse('Invalid ticket type ID', 400)
      }

      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new ErrorResponse(
          'Ticket quantity must be a positive whole number',
          400,
        )
      }

      const currentQuantity =
        quantities.get(item.ticketTypeId) ?? 0

      quantities.set(
        item.ticketTypeId,
        currentQuantity + item.quantity,
      )
    }

    return Array.from(quantities.entries()).map(
      ([ticketTypeId, quantity]) => ({
        ticketTypeId,
        quantity,
      }),
    )
  }

  private generateOrderNumber(): string {
    const suffix = randomBytes(4).toString('hex').toUpperCase()

    return `EVT-${Date.now()}-${suffix}`
  }

  private generatePaystackReference(): string {
    const suffix = randomBytes(8).toString('hex')

    return `eventra-${Date.now()}-${suffix}`
  }

  private calculateServiceFee(subtotal: number): number {
    return Math.round(
      subtotal * (this.serviceFeePercentage / 100),
    )
  }

  private validateSalesPeriod(
    ticketType: ITicketType,
    now: Date,
  ): void {
    if (
      ticketType.salesStartDate &&
      ticketType.salesStartDate > now
    ) {
      throw new ErrorResponse(
        `${ticketType.name} ticket sales have not started`,
        409,
      )
    }

    if (
      ticketType.salesEndDate &&
      ticketType.salesEndDate <= now
    ) {
      throw new ErrorResponse(
        `${ticketType.name} ticket sales have ended`,
        409,
      )
    }
  }

  private validateTicketAvailability(
    ticketType: ITicketType,
    requestedQuantity: number,
  ): void {
    if (!ticketType.isActive) {
      throw new ErrorResponse(
        `${ticketType.name} is not currently available`,
        409,
      )
    }

    if (
      ticketType.purchaseLimitPerPerson &&
      requestedQuantity >
        ticketType.purchaseLimitPerPerson
    ) {
      throw new ErrorResponse(
        `${ticketType.name} has a purchase limit of ` +
          `${ticketType.purchaseLimitPerPerson} per person`,
        400,
      )
    }

    const remainingQuantity =
      ticketType.quantity -
      ticketType.quantitySold -
      ticketType.quantityReserved

    if (requestedQuantity > remainingQuantity) {
      throw new ErrorResponse(
        `Only ${remainingQuantity} ${ticketType.name} ticket(s) remain`,
        409,
      )
    }
  }

  private async releaseOrderReservations(
    order: IOrder,
    reason: string,
  ): Promise<void> {
    const session = await mongoose.startSession()

    try {
      await session.withTransaction(async (): Promise<void> => {
        const pendingOrder = await Order.findOne({
          _id: order._id,
          status: 'pending',
        }).session(session)

        if (!pendingOrder) {
          return
        }

        for (const item of pendingOrder.items) {
          if (!item.ticketType) {
            continue
          }

          await TicketType.updateOne(
            {
              _id: item.ticketType,
              quantityReserved: { $gte: item.quantity },
            },
            {
              $inc: {
                quantityReserved: -item.quantity,
              },
            },
            { session },
          )
        }

        pendingOrder.status = 'failed'
        pendingOrder.failedAt = new Date()
        pendingOrder.failureReason = reason
        await pendingOrder.save({ session })
      })
    } finally {
      await session.endSession()
    }
  }

  async createPaidCheckout(
    input: CreateCheckoutInput,
  ): Promise<CheckoutResult> {
    if (!mongoose.Types.ObjectId.isValid(input.eventId)) {
      throw new ErrorResponse('Invalid event ID', 400)
    }

    if (
      input.buyerId &&
      !mongoose.Types.ObjectId.isValid(input.buyerId)
    ) {
      throw new ErrorResponse('Invalid buyer ID', 400)
    }

    if (!input.items.length) {
      throw new ErrorResponse(
        'At least one ticket item is required',
        400,
      )
    }

    const customer: IOrderCustomer = {
      fullname: input.customer.fullname.trim(),
      email: input.customer.email.trim().toLowerCase(),
      phone: input.customer.phone?.trim(),
    }

    const normalizedItems = this.normalizeItems(input.items)
    const session = await mongoose.startSession()

    let createdOrder: IOrder | undefined

    try {
      await session.withTransaction(async (): Promise<void> => {
        const event = await Event.findOne({
          _id: input.eventId,
          status: 'approved',
          type: 'paid',
          startDate: { $gt: new Date() },
        }).session(session)

        if (!event) {
          throw new ErrorResponse(
            'Paid event is unavailable for checkout',
            404,
          )
        }

        const ticketTypeIds = normalizedItems.map(
          item =>
            new mongoose.Types.ObjectId(item.ticketTypeId),
        )

        const ticketTypes = await TicketType.find({
          _id: { $in: ticketTypeIds },
          event: event._id,
        }).session(session)

        if (ticketTypes.length !== normalizedItems.length) {
          throw new ErrorResponse(
            'One or more ticket types are invalid',
            400,
          )
        }

        const ticketTypesById = new Map(
          ticketTypes.map(ticketType => [
            ticketType._id.toString(),
            ticketType,
          ]),
        )

        const now = new Date()
        const orderItems: IOrderItem[] = []
        let subtotal = 0

        for (const requestedItem of normalizedItems) {
          const ticketType = ticketTypesById.get(
            requestedItem.ticketTypeId,
          )

          if (!ticketType) {
            throw new ErrorResponse(
              'Ticket type not found',
              404,
            )
          }

          this.validateSalesPeriod(ticketType, now)
          this.validateTicketAvailability(
            ticketType,
            requestedItem.quantity,
          )

          const reservationResult =
            await TicketType.updateOne(
              {
                _id: ticketType._id,
                event: event._id,
                isActive: true,
                $expr: {
                  $gte: [
                    {
                      $subtract: [
                        '$quantity',
                        {
                          $add: [
                            '$quantitySold',
                            '$quantityReserved',
                          ],
                        },
                      ],
                    },
                    requestedItem.quantity,
                  ],
                },
              },
              {
                $inc: {
                  quantityReserved:
                    requestedItem.quantity,
                },
              },
              { session },
            )

          if (reservationResult.modifiedCount !== 1) {
            throw new ErrorResponse(
              `${ticketType.name} no longer has enough availability`,
              409,
            )
          }

          const itemSubtotal =
            ticketType.price * requestedItem.quantity

          orderItems.push({
            ticketType: ticketType._id,
            ticketTypeName: ticketType.name,
            unitPrice: ticketType.price,
            quantity: requestedItem.quantity,
            subtotal: itemSubtotal,
          })

          subtotal += itemSubtotal
        }

        const serviceFee =
          this.calculateServiceFee(subtotal)
        const totalAmount = subtotal + serviceFee
        const paystackReference =
          this.generatePaystackReference()

        const orders = await Order.create(
          [
            {
              orderNumber: this.generateOrderNumber(),
              buyer: input.buyerId
                ? new mongoose.Types.ObjectId(input.buyerId)
                : undefined,
              event: event._id,
              customer,
              items: orderItems,
              type: 'paid',
              subtotal,
              serviceFee,
              totalAmount,
              currency: 'NGN',
              paymentProvider: 'paystack',
              status: 'pending',
              paystackReference,
              refundedAmount: 0,
              expiresAt: new Date(
                Date.now() +
                  this.reservationMinutes * 60 * 1000,
              ),
            },
          ],
          { session },
        )

        createdOrder = orders[0]
      })
    } finally {
      await session.endSession()
    }

    if (!createdOrder || !createdOrder.paystackReference) {
      throw new ErrorResponse(
        'Checkout order could not be created',
        500,
      )
    }

    try {
      const initializedTransaction =
        await paystackService.initializeTransaction({
          email: createdOrder.customer.email,
          amountNaira: createdOrder.totalAmount,
          reference: createdOrder.paystackReference,
          callbackUrl:
            `${env.CLIENT_URL.replace(/\/+$/, '')}` +
            '/checkout/confirmation',
          metadata: {
            orderId: createdOrder._id.toString(),
            orderNumber: createdOrder.orderNumber,
            eventId: createdOrder.event.toString(),
          },
        })

      createdOrder.paystackAccessCode =
        initializedTransaction.accessCode
      await createdOrder.save()

      return {
        orderId: createdOrder._id.toString(),
        orderNumber: createdOrder.orderNumber,
        reference: initializedTransaction.reference,
        subtotal: createdOrder.subtotal,
        serviceFee: createdOrder.serviceFee,
        totalAmount: createdOrder.totalAmount,
        currency: 'NGN',
        authorizationUrl:
          initializedTransaction.authorizationUrl,
      }
    } catch (error: unknown) {
      const reason =
        error instanceof Error
          ? error.message
          : 'Paystack initialization failed'

      await this.releaseOrderReservations(
        createdOrder,
        reason,
      )

      throw error
    }
  }
}

export const checkoutService = new CheckoutService()