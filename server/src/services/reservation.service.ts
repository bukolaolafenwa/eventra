import { randomBytes } from 'crypto'
import mongoose from 'mongoose'

import { ErrorResponse } from '../middlewares/error.middleware.js'
import Event from '../models/event.js'
import Order, {
  IOrder,
  IOrderCustomer,
} from '../models/order.js'
import { EmailService } from './email.service.js'
import { ticketService } from './ticket.service.js'

export interface CreateReservationInput {
  eventId: string
  buyerId?: string
  customer: IOrderCustomer
  quantity: number
}

export interface ReservationResult {
  orderId: string
  orderNumber: string
  status: 'confirmed'
  quantity: number
  ticketCodes: string[]
  emailSent: boolean
}

interface IssuedTicket {
  code: string
}

export class ReservationService {
  private validateObjectId(
    id: string,
    label: string,
  ): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ErrorResponse(`Invalid ${label} ID`, 400)
    }
  }

  private generateOrderNumber(): string {
    const suffix = randomBytes(4)
      .toString('hex')
      .toUpperCase()

    return `EVT-${Date.now()}-${suffix}`
  }

  private formatEventDate(date: Date): string {
    return new Intl.DateTimeFormat('en-NG', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Africa/Lagos',
    }).format(date)
  }

  async createReservation(
    input: CreateReservationInput,
  ): Promise<ReservationResult> {
    this.validateObjectId(input.eventId, 'event')

    if (input.buyerId) {
      this.validateObjectId(input.buyerId, 'buyer')
    }

    if (
      !Number.isInteger(input.quantity) ||
      input.quantity < 1 ||
      input.quantity > 4
    ) {
      throw new ErrorResponse(
        'Reservation quantity must be between 1 and 4',
        400,
      )
    }

    const customer: IOrderCustomer = {
      fullname: input.customer.fullname.trim(),
      email: input.customer.email
        .trim()
        .toLowerCase(),
      phone: input.customer.phone?.trim(),
    }

    const session = await mongoose.startSession()

    let createdOrder: IOrder | undefined
    let eventDetails:
      | {
          title: string
          startDate: Date
          venueLabel: string
        }
      | undefined

    try {
      await session.withTransaction(
        async (): Promise<void> => {
          const event = await Event.findOne({
            _id: input.eventId,
            type: 'free',
            status: 'approved',
            startDate: { $gt: new Date() },
          }).session(session)

          if (!event) {
            throw new ErrorResponse(
              'Free event is unavailable for reservation',
              404,
            )
          }

          /*
           * Capacity is optional. When it is present, this conditional
           * update prevents simultaneous reservations from exceeding it.
           */
          if (event.capacity !== undefined) {
            const capacityUpdate =
              await Event.updateOne(
                {
                  _id: event._id,
                  type: 'free',
                  status: 'approved',
                  startDate: { $gt: new Date() },
                  $expr: {
                    $lte: [
                      {
                        $add: [
                          '$reservationsCount',
                          input.quantity,
                        ],
                      },
                      '$capacity',
                    ],
                  },
                },
                {
                  $inc: {
                    reservationsCount:
                      input.quantity,
                  },
                },
                { session },
              )

            if (capacityUpdate.modifiedCount !== 1) {
              throw new ErrorResponse(
                'The event does not have enough available spaces',
                409,
              )
            }
          } else {
            const reservationUpdate =
              await Event.updateOne(
                {
                  _id: event._id,
                  type: 'free',
                  status: 'approved',
                  startDate: { $gt: new Date() },
                },
                {
                  $inc: {
                    reservationsCount:
                      input.quantity,
                  },
                },
                { session },
              )

            if (
              reservationUpdate.modifiedCount !== 1
            ) {
              throw new ErrorResponse(
                'Event is unavailable for reservation',
                409,
              )
            }
          }

          const orders = await Order.create(
            [
              {
                orderNumber:
                  this.generateOrderNumber(),

                buyer: input.buyerId
                  ? new mongoose.Types.ObjectId(
                      input.buyerId,
                    )
                  : undefined,

                event: event._id,
                customer,

                items: [
                  {
                    ticketTypeName:
                      'General Admission (RSVP)',
                    unitPrice: 0,
                    quantity: input.quantity,
                    subtotal: 0,
                  },
                ],

                type: 'free',
                subtotal: 0,
                serviceFee: 0,
                totalAmount: 0,
                currency: 'NGN',
                paymentProvider: 'none',
                status: 'confirmed',
                refundedAmount: 0,
                confirmedAt: new Date(),
              },
            ],
            { session },
          )

          createdOrder = orders[0]

          eventDetails = {
            title: event.title,
            startDate: event.startDate,
            venueLabel: [
              event.venue.name,
              event.venue.city,
            ]
              .filter(Boolean)
              .join(', '),
          }
        },
      )
    } finally {
      await session.endSession()
    }

    if (!createdOrder || !eventDetails) {
      throw new ErrorResponse(
        'Reservation could not be created',
        500,
      )
    }

    /*
     * The confirmed order now exists, so the existing idempotent ticket
     * service can create one QR ticket for every reserved admission.
     */
    const issuedTickets =
      (await ticketService.issueTicketsForOrder(
        createdOrder._id.toString(),
      )) as IssuedTicket[]

    const ticketCodes = issuedTickets.map(
      ticket => ticket.code,
    )

    /*
     * Email delivery is best-effort. Failure must not invalidate an
     * otherwise successful reservation and issued tickets.
     */
    let emailSent = false

    try {
      const emailResult =
        await EmailService.sendTicketConfirmationEmail({
          user: {
            fullname: customer.fullname,
            email: customer.email,
          },
          eventTitle: eventDetails.title,
          eventDateLabel: this.formatEventDate(
            eventDetails.startDate,
          ),
          venueLabel: eventDetails.venueLabel,
          ticketCodes,
        })

      emailSent = emailResult.success
    } catch {
      emailSent = false
    }

    return {
      orderId: createdOrder._id.toString(),
      orderNumber: createdOrder.orderNumber,
      status: 'confirmed',
      quantity: input.quantity,
      ticketCodes,
      emailSent,
    }
  }
}

export const reservationService =
  new ReservationService()