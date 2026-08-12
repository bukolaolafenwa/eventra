import mongoose from 'mongoose'

import { ErrorResponse } from '../middlewares/error.middleware.js'
import Event from '../models/event.js'
import Order, { IOrder } from '../models/order.js'
import Ticket from '../models/ticket.js'
import TicketType from '../models/tickettype.js'
import { EmailService } from './email.service.js'
import { paystackService } from './paystack.service.js'
import { ticketService } from './ticket.service.js'

export interface PaymentConfirmationResult {
  orderId: string
  orderNumber: string
  reference: string
  status: 'paid'
  totalAmount: number
  currency: 'NGN'
  ticketCount: number
}

export interface PaystackWebhookPayload {
  event: string
  data?: {
    reference?: string
  }
}

export interface WebhookProcessingResult {
  processed: boolean
  event: string
  payment?: PaymentConfirmationResult
}

export class PaymentService {
  private async finalizePaidOrder(
    order: IOrder,
    paidAt: Date,
  ): Promise<void> {
    const session = await mongoose.startSession()

    try {
      await session.withTransaction(
        async (): Promise<void> => {
          const currentOrder = await Order.findById(
            order._id,
          ).session(session)

          if (!currentOrder) {
            throw new ErrorResponse(
              'Order not found',
              404,
            )
          }

          // A repeated callback or webhook must not increment inventory
          // or event totals for a second time.
          if (
            currentOrder.status === 'paid' ||
            currentOrder.status === 'confirmed'
          ) {
            return
          }

          if (currentOrder.status !== 'pending') {
            throw new ErrorResponse(
              `Order cannot be paid from status ${currentOrder.status}`,
              409,
            )
          }

          let totalTicketQuantity = 0

          for (const item of currentOrder.items) {
            if (!item.ticketType) {
              throw new ErrorResponse(
                'Paid order item is missing its ticket type',
                500,
              )
            }

            const inventoryUpdate =
              await TicketType.updateOne(
                {
                  _id: item.ticketType,
                  event: currentOrder.event,
                  quantityReserved: {
                    $gte: item.quantity,
                  },
                },
                {
                  $inc: {
                    quantityReserved: -item.quantity,
                    quantitySold: item.quantity,
                  },
                },
                { session },
              )

            if (
              inventoryUpdate.modifiedCount !== 1
            ) {
              throw new ErrorResponse(
                `Reserved inventory for ${item.ticketTypeName} is inconsistent`,
                409,
              )
            }

            totalTicketQuantity += item.quantity
          }

          const eventUpdate = await Event.updateOne(
            { _id: currentOrder.event },
            {
              $inc: {
                ticketsSoldCount:
                  totalTicketQuantity,
                revenueTotal:
                  currentOrder.subtotal,
              },
            },
            { session },
          )

          if (eventUpdate.modifiedCount !== 1) {
            throw new ErrorResponse(
              'Event sales totals could not be updated',
              500,
            )
          }

          currentOrder.status = 'paid'
          currentOrder.paidAt = paidAt
          currentOrder.failureReason = undefined

          await currentOrder.save({ session })
        },
      )
    } finally {
      await session.endSession()
    }
  }

  private async sendTicketConfirmationEmail(
    orderId: mongoose.Types.ObjectId,
  ): Promise<void> {
    const now = new Date()
    const staleSendingTime = new Date(
      now.getTime() - 5 * 60 * 1000,
    )

    /*
     * Atomically claim email delivery. This prevents the browser
     * callback and Paystack webhook from sending the same email
     * concurrently. An abandoned claim is retryable after five minutes.
     */
    const claimedOrder =
      await Order.findOneAndUpdate(
        {
          _id: orderId,
          status: 'paid',
          ticketConfirmationEmailSentAt: {
            $exists: false,
          },
          $or: [
            {
              ticketConfirmationEmailSendingAt: {
                $exists: false,
              },
            },
            {
              ticketConfirmationEmailSendingAt: {
                $lte: staleSendingTime,
              },
            },
          ],
        },
        {
          $set: {
            ticketConfirmationEmailSendingAt:
              now,
          },
        },
        {
          new: true,
        },
      ).lean()

    if (!claimedOrder) {
      return
    }

    try {
      const [event, tickets] =
        await Promise.all([
          Event.findById(claimedOrder.event)
            .select('title startDate venue')
            .lean(),

          Ticket.find({
            order: claimedOrder._id,
          })
            .select('code')
            .sort({ sequence: 1 })
            .lean(),
        ])

      if (!event) {
        throw new ErrorResponse(
          'Event not found',
          404,
        )
      }

      if (tickets.length === 0) {
        throw new ErrorResponse(
          'No tickets found for confirmation email',
          500,
        )
      }

      const emailResult =
        await EmailService.sendTicketConfirmationEmail(
          {
            user: {
              fullname:
                claimedOrder.customer.fullname,
              email:
                claimedOrder.customer.email,
            },
            eventTitle: event.title,
            eventDateLabel:
              new Intl.DateTimeFormat('en-NG', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Africa/Lagos',
              }).format(event.startDate),
            venueLabel: [
              event.venue.name,
              event.venue.city,
            ]
              .filter(Boolean)
              .join(', '),
            ticketCodes: tickets.map(
              ticket => ticket.code,
            ),
          },
        )

      if (!emailResult.success) {
        throw new Error(
          'Ticket confirmation email could not be sent',
        )
      }

      await Order.updateOne(
        { _id: claimedOrder._id },
        {
          $set: {
            ticketConfirmationEmailSentAt:
              new Date(),
          },
          $unset: {
            ticketConfirmationEmailSendingAt: 1,
          },
        },
      )
    } catch {
      /*
       * Release the claim so a later verification can retry.
       * Email failure must not reverse a successful payment.
       */
      await Order.updateOne(
        { _id: claimedOrder._id },
        {
          $unset: {
            ticketConfirmationEmailSendingAt: 1,
          },
        },
      )
    }
  }

  async confirmPaystackPayment(
    reference: string,
  ): Promise<PaymentConfirmationResult> {
    const normalizedReference = reference.trim()

    if (!normalizedReference) {
      throw new ErrorResponse(
        'Payment reference is required',
        400,
      )
    }

    const order = await Order.findOne({
      paystackReference: normalizedReference,
    })

    if (!order) {
      throw new ErrorResponse(
        'Order for this payment was not found',
        404,
      )
    }

    if (
      order.paymentProvider !== 'paystack' ||
      order.type !== 'paid'
    ) {
      throw new ErrorResponse(
        'Order is not a paid Paystack order',
        409,
      )
    }

    /*
     * Always verify with Paystack. The backend must not trust a
     * reference supplied by the client without server verification.
     */
    const verifiedTransaction =
      await paystackService.verifyTransaction(
        normalizedReference,
        order.totalAmount,
      )

    const verifiedPaidAt =
      verifiedTransaction.paidAt
        ? new Date(verifiedTransaction.paidAt)
        : new Date()

    const paidAt = Number.isNaN(
      verifiedPaidAt.getTime(),
    )
      ? new Date()
      : verifiedPaidAt

    await this.finalizePaidOrder(order, paidAt)

    /*
     * TicketService is independently idempotent through the unique
     * { order, sequence } index, so retries cannot create duplicates.
     */
    const tickets =
      await ticketService.issueTicketsForOrder(
        order._id.toString(),
      )

    /*
     * Email delivery is separately idempotent. A repeated browser
     * verification or webhook will not send the email twice.
     */
    await this.sendTicketConfirmationEmail(
      order._id,
    )

    return {
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      reference: normalizedReference,
      status: 'paid',
      totalAmount: order.totalAmount,
      currency: 'NGN',
      ticketCount: tickets.length,
    }
  }

  async processPaystackWebhook(
    payload: PaystackWebhookPayload,
    signature: string | undefined,
  ): Promise<WebhookProcessingResult> {
    const signatureIsValid =
      paystackService.validateWebhookSignature(
        payload,
        signature,
      )

    if (!signatureIsValid) {
      throw new ErrorResponse(
        'Invalid Paystack webhook signature',
        401,
      )
    }

    /*
     * Acknowledge Paystack events that Eventra does not currently
     * process without treating them as successful payments.
     */
    if (payload.event !== 'charge.success') {
      return {
        processed: false,
        event: payload.event,
      }
    }

    const reference = payload.data?.reference

    if (!reference) {
      throw new ErrorResponse(
        'Paystack webhook is missing a payment reference',
        400,
      )
    }

    const payment =
      await this.confirmPaystackPayment(reference)

    return {
      processed: true,
      event: payload.event,
      payment,
    }
  }
}

export const paymentService =
  new PaymentService()