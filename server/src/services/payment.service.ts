import mongoose from 'mongoose'

import { ErrorResponse } from '../middlewares/error.middleware.js'
import Event from '../models/event.js'
import Order, { IOrder } from '../models/order.js'
import TicketType from '../models/tickettype.js'
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
      await session.withTransaction(async (): Promise<void> => {
        const currentOrder = await Order.findById(
          order._id,
        ).session(session)

        if (!currentOrder) {
          throw new ErrorResponse('Order not found', 404)
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

          if (inventoryUpdate.modifiedCount !== 1) {
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
              ticketsSoldCount: totalTicketQuantity,
              revenueTotal: currentOrder.subtotal,
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
      })
    } finally {
      await session.endSession()
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
     * Always verify with Paystack, even if this endpoint is called by
     * the browser. The backend must not trust a reference supplied by
     * the client without server-to-server verification.
     */
    const verifiedTransaction =
      await paystackService.verifyTransaction(
        normalizedReference,
        order.totalAmount,
      )

    const verifiedPaidAt = verifiedTransaction.paidAt
      ? new Date(verifiedTransaction.paidAt)
      : new Date()

    const paidAt = Number.isNaN(verifiedPaidAt.getTime())
      ? new Date()
      : verifiedPaidAt

    await this.finalizePaidOrder(order, paidAt)

    /*
     * TicketService is independently idempotent through the unique
     * { order, sequence } index, so webhook retries cannot create
     * duplicate tickets.
     */
    const tickets =
      await ticketService.issueTicketsForOrder(
        order._id.toString(),
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
     * Paystack can send event types that Eventra does not currently
     * handle. Acknowledge them without treating them as payments.
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

export const paymentService = new PaymentService()