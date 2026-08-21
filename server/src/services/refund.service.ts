import mongoose from 'mongoose'
import Order from '../models/order.js'
import RefundRequest from '../models/refundRequest.js'
import Ticket from '../models/ticket.js'

export interface PaystackRefundWebhookData {
  status?: string
  transaction_reference?: string
  refund_reference?: string | null
  amount?: string | number
  currency?: string
}

export interface RefundWebhookResult {
  processed: boolean
  refundRequestId?: string
  status?: string
}

export class RefundService {
  async reconcileWebhook(
    event: string,
    data: PaystackRefundWebhookData,
  ): Promise<RefundWebhookResult> {
    const transactionReference = data.transaction_reference?.trim()
    const amountKobo = Number(data.amount)

    if (!transactionReference || !Number.isFinite(amountKobo) || amountKobo <= 0) {
      return { processed: false }
    }

    const order = await Order.findOne({ paystackReference: transactionReference })
    if (!order) return { processed: false }

    const amountNaira = Math.round(amountKobo / 100)
    const refundRequest = await RefundRequest.findOne({
      order: order._id,
      amount: amountNaira,
      status: 'approved',
    }).sort({ approvedAt: 1 })

    if (!refundRequest) return { processed: false }

    const providerStatus = data.status || event.replace('refund.', '')
    refundRequest.providerStatus = providerStatus
    if (data.refund_reference) {
      refundRequest.paystackRefundReference = data.refund_reference
    }

    if (event === 'refund.failed' || event === 'refund.needs-attention') {
      refundRequest.processingNote =
        event === 'refund.failed'
          ? 'Paystack reported that the refund failed'
          : 'Paystack requires customer bank details to continue the refund'
      await refundRequest.save()
      return {
        processed: true,
        refundRequestId: refundRequest._id.toString(),
        status: refundRequest.status,
      }
    }

    if (event !== 'refund.processed') {
      await refundRequest.save()
      return {
        processed: true,
        refundRequestId: refundRequest._id.toString(),
        status: refundRequest.status,
      }
    }

    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        const currentRequest = await RefundRequest.findOne({
          _id: refundRequest._id,
          status: 'approved',
        }).session(session)

        if (!currentRequest) return

        const processedAt = new Date()
        const nextRefundedAmount = Math.min(
          order.subtotal,
          order.refundedAmount + currentRequest.amount,
        )

        currentRequest.status = 'processed'
        currentRequest.providerStatus = 'processed'
        currentRequest.processedAt = processedAt
        currentRequest.processingNote = undefined
        if (data.refund_reference) {
          currentRequest.paystackRefundReference = data.refund_reference
        }
        await currentRequest.save({ session })

        await Ticket.updateOne(
          { _id: currentRequest.ticket, status: { $ne: 'refunded' } },
          { $set: { status: 'refunded', refundedAt: processedAt } },
          { session },
        )
        await Order.updateOne(
          { _id: order._id },
          {
            $set: {
              refundedAmount: nextRefundedAmount,
              status:
                nextRefundedAmount >= order.subtotal
                  ? 'refunded'
                  : 'partially_refunded',
            },
          },
          { session },
        )
      })
    } finally {
      await session.endSession()
    }

    return {
      processed: true,
      refundRequestId: refundRequest._id.toString(),
      status: 'processed',
    }
  }
}

export const refundService = new RefundService()
