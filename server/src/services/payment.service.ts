import mongoose from 'mongoose'

import { getPromotionPackage } from '../config/promotionPackages.js'
import { ErrorResponse } from '../middlewares/error.middleware.js'
import Event from '../models/event.js'
import Order, { IOrder } from '../models/order.js'
import Ticket from '../models/ticket.js'
import TicketType from '../models/tickettype.js'
import { EmailService } from './email.service.js'
import { paystackService } from './paystack.service.js'
import {
  payoutService,
  type PaystackTransferWebhookData,
  type PaystackTransferWebhookEvent,
  type ReconciledPayoutResult,
} from './payout.service.js'
import { ticketService } from './ticket.service.js'
import {
  PaystackRefundWebhookData,
  RefundWebhookResult,
  refundService,
} from './refund.service.js'

export interface PaymentConfirmationResult {
  orderId: string
  orderNumber: string
  reference: string
  status: 'paid'
  totalAmount: number
  currency: 'NGN'
  ticketCount: number
}

export interface PromotionPaymentConfirmationResult {
  eventId: string
  reference: string
  packageId: string
  alreadyConfirmed: boolean
}

export interface PaystackWebhookData
  extends Omit<PaystackTransferWebhookData, 'amount'>,
    PaystackRefundWebhookData {
  amount?: string | number
}

export interface PaystackWebhookPayload {
  event: string
  data?: PaystackWebhookData
}

export interface WebhookProcessingResult {
  processed: boolean
  event: string
  payment?: PaymentConfirmationResult
  promotionPayment?: PromotionPaymentConfirmationResult
  payout?: ReconciledPayoutResult
  refund?: RefundWebhookResult
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

/**
 * Verifies and confirms a Paystack payment for an event promotion.
 *
 * Promotion payments are stored directly on the Event rather than in an
 * Order, so the event is located using its unique Paystack reference.
 * Verification checks the expected package amount, NGN currency, payment
 * status, reference and Paystack metadata before recording payment.
 *
 * The conditional update makes confirmation idempotent and race-safe:
 * repeated callbacks, browser verification and webhook deliveries cannot
 * confirm or mutate the same promotion payment more than once.
 */
 async confirmPromotionPayment(
  reference: string,
): Promise<PromotionPaymentConfirmationResult> {
  const normalizedReference =
    reference.trim()

  if (!normalizedReference) {
    throw new ErrorResponse(
      'Payment reference is required',
      400,
    )
  }

  const event =
    await Event.findOne({
      'promotion.paystackReference':
        normalizedReference,
    }).lean()

  if (!event || !event.promotion) {
    throw new ErrorResponse(
      'No promotion request found for this reference',
      404,
    )
  }

  if (event.promotion.paidAt) {
    return {
      eventId:
        event._id.toString(),
      reference:
        normalizedReference,
      packageId:
        event.promotion.package,
      alreadyConfirmed: true,
    }
  }

  const pkg =
    getPromotionPackage(
      event.promotion.package,
    )

  if (!pkg) {
    throw new ErrorResponse(
      'Unknown promotion package for this event',
      500,
    )
  }

  const transaction =
    await paystackService
      .verifyTransaction(
        normalizedReference,
        pkg.priceNaira,
      )

  const metadataEventId =
    transaction.metadata?.eventId

  const metadataPackageId =
    transaction.metadata?.packageId

  if (
    metadataEventId !==
      event._id.toString() ||
    metadataPackageId !==
      event.promotion.package
  ) {
    throw new ErrorResponse(
      'Verified promotion payment metadata does not match the promotion request',
      409,
    )
  }

  const paidAt =
    transaction.paidAt
      ? new Date(
          transaction.paidAt,
        )
      : new Date()

  const updateResult =
    await Event.updateOne(
      {
        _id: event._id,
        'promotion.paystackReference':
          normalizedReference,
        'promotion.paidAt': {
          $exists: false,
        },
      },
      {
        $set: {
          'promotion.paidAt':
            paidAt,
        },
      },
    )

  return {
    eventId:
      event._id.toString(),
    reference:
      normalizedReference,
    packageId:
      event.promotion.package,
    alreadyConfirmed:
      updateResult.modifiedCount ===
      0,
  }
}

  async processPaystackWebhook(
    payload: PaystackWebhookPayload,
    signature: string | undefined,
    rawBody: Buffer | undefined,
  ): Promise<WebhookProcessingResult> {
    const signatureIsValid =
      paystackService.validateWebhookSignature(
        rawBody,
        signature,
      )

    if (!signatureIsValid) {
      throw new ErrorResponse(
        'Invalid Paystack webhook signature',
        401,
      )
    }

    if (
      payload.event ===
      'charge.success'
    ) {
      const reference =
        payload.data?.reference

      if (!reference) {
        throw new ErrorResponse(
          'Paystack webhook is missing a payment reference',
          400,
        )
      }

      // A promotion payment (see requestPromotion in
      // promotion.controller.ts) has no Order behind it — it's a field on
      // Event.promotion — so it can't go through confirmPaystackPayment's
      // Order-lookup path below. Branch on the PROMO- prefix that
      // requestPromotion always uses for these references.
      if (reference.startsWith('PROMO-')) {
        const promotionPayment =
          await this.confirmPromotionPayment(
            reference,
          )

        return {
          processed: true,
          event: payload.event,
          promotionPayment,
        }
      }

      const payment =
        await this.confirmPaystackPayment(
          reference,
        )

      return {
        processed: true,
        event: payload.event,
        payment,
      }
    }

    const isTransferEvent =
      payload.event ===
        'transfer.success' ||
      payload.event ===
        'transfer.failed' ||
      payload.event ===
        'transfer.reversed'

    if (isTransferEvent) {
      const payout =
        await payoutService
          .reconcileTransferWebhook(
            payload.event as PaystackTransferWebhookEvent,
            (payload.data ?? {}) as PaystackTransferWebhookData,
          )

      return {
        processed:
          payout.processed,
        event:
          payload.event,
        payout,
      }
    }

    const isRefundEvent = [
      'refund.pending',
      'refund.processing',
      'refund.needs-attention',
      'refund.failed',
      'refund.processed',
    ].includes(payload.event)

    if (isRefundEvent) {
      const refund = await refundService.reconcileWebhook(
        payload.event,
        payload.data ?? {},
      )

      return {
        processed: refund.processed,
        event: payload.event,
        refund,
      }
    }

    /*
     * Validly signed Paystack events that Eventra does not support are
     * acknowledged without changing any payment or payout records.
     */
    return {
      processed: false,
      event: payload.event,
    }
  }
}

export const paymentService =
  new PaymentService()
