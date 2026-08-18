import { randomBytes } from 'crypto'
import mongoose from 'mongoose'

import {
  getPayoutEligibleAt,
  isPayoutEligible,
} from '../lib/payoutPolicy.js'
import { ErrorResponse } from '../middlewares/error.middleware.js'
import Event from '../models/event.js'
import Order from '../models/order.js'
import Payout, {
  IPayout,
} from '../models/payout.js'
import User from '../models/user.js'
import { PaystackTransferRejectedError, paystackService, } from './paystack.service.js'


export interface InitiatedPayoutResult {
  payoutId: string
  eventId: string
  organizerId: string
  reference: string
  transferCode?: string
  grossAmount: number
  commissionAmount: number
  netAmount: number
  currency: 'NGN'
  status: IPayout['status']
  eligibleAt: Date
}

export type PaystackTransferWebhookEvent =
  | 'transfer.success'
  | 'transfer.failed'
  | 'transfer.reversed'

export interface PaystackTransferWebhookData {
  reference?: string
  transfer_code?: string
  status?: string
  amount?: number
  currency?: string
  transferred_at?: string | null
  reason?: string
  gateway_response?: string | null
}

export interface ReconciledPayoutResult {
  payoutId: string
  reference: string
  eventId: string
  status: IPayout['status']
  providerStatus?: string
  transferCode?: string
  processed: boolean
}

export class PayoutService {
  private validateObjectId(
    id: string,
    label: string,
  ): void {
    if (
      !mongoose.Types.ObjectId.isValid(id)
    ) {
      throw new ErrorResponse(
        `Invalid ${label} ID`,
        400,
      )
    }
  }

  private generateReference(): string {
    return `eventra-payout-${randomBytes(8)
      .toString('hex')}`
  }

  /**
   * Creates and initiates one admin-approved payout for a paid event.
   *
   * The Payout record is created before Paystack is called, giving the
   * transfer a durable reference that signed webhooks can reconcile even
   * if the HTTP request times out or the application restarts.
   */
  async initiateEventPayout(
    eventId: string,
    adminId: string,
    now: Date = new Date(),
  ): Promise<InitiatedPayoutResult> {
    this.validateObjectId(
      eventId,
      'event',
    )
    this.validateObjectId(
      adminId,
      'admin',
    )

    const event = await Event.findById(
      eventId,
    ).lean()

    if (!event) {
      throw new ErrorResponse(
        'Event not found',
        404,
      )
    }

    if (event.type !== 'paid') {
      throw new ErrorResponse(
        'Free events do not have payouts',
        400,
      )
    }

    if (
      event.status !== 'approved' &&
      event.status !== 'postponed'
    ) {
      throw new ErrorResponse(
        'Only approved or postponed events can be paid out',
        409,
      )
    }

    const eligibleAt =
      getPayoutEligibleAt(
        event.startDate,
        event.endDate,
      )

    if (
      !isPayoutEligible(
        event.startDate,
        event.endDate,
        now,
      )
    ) {
      throw new ErrorResponse(
        `This payout is held until ${eligibleAt.toISOString()}`,
        409,
      )
    }

    const existingPayout =
      await Payout.findOne({
        event: event._id,
      }).lean()

    if (existingPayout) {
      throw new ErrorResponse(
        'A payout record already exists for this event',
        409,
      )
    }

    const organizer =
      await User.findById(
        event.organizer,
      ).select(
        'role isSuspended organizerProfile',
      )

    if (
      !organizer ||
      organizer.role !== 'organizer'
    ) {
      throw new ErrorResponse(
        'Event organizer not found',
        404,
      )
    }

    if (organizer.isSuspended) {
      throw new ErrorResponse(
        'Payouts are unavailable for a suspended organizer',
        409,
      )
    }

    const profile =
      organizer.organizerProfile

    if (
      profile?.approvalStatus !==
      'approved'
    ) {
      throw new ErrorResponse(
        'Organizer is not approved for payouts',
        409,
      )
    }

    if (
      !profile.isPayoutReady ||
      !profile.paystackRecipientCode ||
      !profile.bankName ||
      !profile.bankCode ||
      !profile.accountName ||
      !profile.accountNumber
    ) {
      throw new ErrorResponse(
        'Organizer has not completed payout setup',
        409,
      )
    }

    /*
     * Partially refunded orders require separate commission
     * reconciliation. Block the event instead of silently paying an
     * incorrect amount.
     */
    const unsupportedOrders =
      await Order.exists({
        event: event._id,
        $or: [
          {
            status:
              'partially_refunded',
          },
          {
            status: 'paid',
            refundedAmount: {
              $gt: 0,
            },
          },
        ],
      })

    if (unsupportedOrders) {
      throw new ErrorResponse(
        'This event has partially refunded orders requiring reconciliation before payout',
        409,
      )
    }

    const orders = await Order.find({
      event: event._id,
      type: 'paid',
      status: 'paid',
      refundedAmount: 0,
    })
      .select(
        '_id subtotal serviceFee refundedAmount',
      )
      .lean()

    if (orders.length === 0) {
      throw new ErrorResponse(
        'This event has no eligible paid orders',
        409,
      )
    }

    const grossAmount = orders.reduce(
      (total, order) =>
        total + order.subtotal,
      0,
    )

    const refundedAmount =
      orders.reduce(
        (total, order) =>
          total +
          order.refundedAmount,
        0,
      )

    const commissionAmount =
      orders.reduce(
        (total, order) =>
          total + order.serviceFee,
        0,
      )

    const netAmount =
      grossAmount -
      refundedAmount -
      commissionAmount

    if (netAmount <= 0) {
      throw new ErrorResponse(
        'Calculated payout amount must be greater than zero',
        409,
      )
    }

    const reference =
      this.generateReference()

    let payout: IPayout

    try {
      payout = await Payout.create({
        organizer: organizer._id,
        event: event._id,
        orders: orders.map(
          order => order._id,
        ),

        grossAmount,
        refundedAmount,
        commissionAmount,
        netAmount,
        currency: 'NGN',

        provider: 'paystack',
        recipientCode:
          profile.paystackRecipientCode,
        reference,

        destination: {
          bankName:
            profile.bankName,
          bankCode:
            profile.bankCode,
          accountName:
            profile.accountName,
          accountNumberLast4:
            profile.accountNumber.slice(
              -4,
            ),
        },

        status: 'pending',
        eligibleAt,
        initiatedBy:
          new mongoose.Types.ObjectId(
            adminId,
          ),
        initiatedAt: now,
      })
    } catch (error: unknown) {
      const mongoError =
        error as { code?: number }

      if (mongoError.code === 11000) {
        throw new ErrorResponse(
          'This event or one of its orders already belongs to a payout',
          409,
        )
      }

      throw error
    }

    try {
      const transfer =
        await paystackService
          .initiateTransfer({
            amountNaira: netAmount,
            recipientCode:
              profile.paystackRecipientCode,
            reference,
            reason: `Eventra payout for ${event.title}`,
          })

      /*
       * Never overwrite a final webhook update. Paystack may deliver a
       * transfer.success event before this initiation request finishes.
       */
      await Payout.updateOne(
        {
          _id: payout._id,
          status: 'pending',
        },
        {
          $set: {
            transferCode:
              transfer.transferCode,
            providerStatus:
              transfer.status,
            status:
              transfer.status === 'otp'
                ? 'otp_required'
                : 'processing',
          },
        },
      )
      } catch (error: unknown) {
      const wasExplicitlyRejected =
        error instanceof
        PaystackTransferRejectedError

      /*
       * An explicit Paystack rejection is conclusive and can safely mark
       * the payout failed. A timeout or network failure is ambiguous:
       * Paystack may have accepted the transfer, so preserve the reference
       * and leave that payout pending for later verification.
       *
       * The pending-status filter also prevents this catch block from
       * overwriting a final status delivered by a fast webhook.
       */
      await Payout.updateOne(
        {
          _id: payout._id,
          status: 'pending',
        },
        {
          $set: {
            status:
              wasExplicitlyRejected
                ? 'failed'
                : 'pending',
            providerStatus:
              wasExplicitlyRejected
                ? 'initiation_rejected'
                : 'initiation_unknown',
            failureReason:
              error instanceof Error
                ? error.message
                : wasExplicitlyRejected
                  ? 'Paystack rejected the transfer'
                  : 'Transfer initiation outcome is unknown',
            ...(wasExplicitlyRejected
              ? { failedAt: now }
              : {}),
          },
        },
      )

      throw error
    }

    const updatedPayout =
      await Payout.findById(
        payout._id,
      ).lean()

    if (!updatedPayout) {
      throw new ErrorResponse(
        'Payout record could not be reloaded',
        500,
      )
    }

    return {
      payoutId:
        updatedPayout._id.toString(),
      eventId:
        updatedPayout.event.toString(),
      organizerId:
        updatedPayout.organizer.toString(),
      reference:
        updatedPayout.reference,
      transferCode:
        updatedPayout.transferCode,
      grossAmount:
        updatedPayout.grossAmount,
      commissionAmount:
        updatedPayout.commissionAmount,
      netAmount:
        updatedPayout.netAmount,
      currency:
        updatedPayout.currency,
      status:
        updatedPayout.status,
      eligibleAt:
        updatedPayout.eligibleAt,
    }
  }

  /**
   * Reconciles a signed Paystack transfer webhook with its existing payout.
   *
   * Webhook delivery is idempotent: repeated events return the existing
   * state without duplicating accounting changes. Terminal states cannot
   * be moved backwards, while a legitimate reversal may move a paid payout
   * to reversed.
   */
  async reconcileTransferWebhook(
    event: PaystackTransferWebhookEvent,
    data: PaystackTransferWebhookData,
    now: Date = new Date(),
  ): Promise<ReconciledPayoutResult> {
    const reference =
      data.reference?.trim().toLowerCase()

    if (!reference) {
      throw new ErrorResponse(
        'Paystack transfer webhook is missing its reference',
        400,
      )
    }

    const payout =
      await Payout.findOne({
        reference,
      })

    if (!payout) {
      throw new ErrorResponse(
        'Payout not found for this transfer reference',
        404,
      )
    }

    if (
      data.currency &&
      data.currency !== payout.currency
    ) {
      throw new ErrorResponse(
        'Paystack transfer currency does not match the payout',
        409,
      )
    }

    if (
      data.amount !== undefined &&
      data.amount !==
        payout.netAmount * 100
    ) {
      throw new ErrorResponse(
        'Paystack transfer amount does not match the payout',
        409,
      )
    }

    if (
      payout.transferCode &&
      data.transfer_code &&
      payout.transferCode !==
        data.transfer_code
    ) {
      throw new ErrorResponse(
        'Paystack transfer code does not match the payout',
        409,
      )
    }

    if (
      !payout.transferCode &&
      data.transfer_code
    ) {
      payout.transferCode =
        data.transfer_code
    }

    const providerStatus =
      data.status ??
      event.replace('transfer.', '')

    const failureReason =
      data.reason ??
      data.gateway_response ??
      undefined

    let processed = false

    if (event === 'transfer.success') {
      if (
        payout.status === 'pending' ||
        payout.status === 'processing' ||
        payout.status === 'otp_required'
      ) {
        payout.status = 'paid'
        payout.providerStatus =
          providerStatus
        payout.paidAt =
          data.transferred_at &&
          !Number.isNaN(
            Date.parse(
              data.transferred_at,
            ),
          )
            ? new Date(
                data.transferred_at,
              )
            : now
        payout.failureReason =
          undefined
        payout.failedAt =
          undefined
        processed = true
      }
    } else if (
      event === 'transfer.failed'
    ) {
      if (
        payout.status === 'pending' ||
        payout.status === 'processing' ||
        payout.status === 'otp_required'
      ) {
        payout.status = 'failed'
        payout.providerStatus =
          providerStatus
        payout.failureReason =
          failureReason ??
          'Paystack transfer failed'
        payout.failedAt = now
        processed = true
      }
    } else if (
      event === 'transfer.reversed'
    ) {
      if (
        payout.status !== 'reversed'
      ) {
        payout.status = 'reversed'
        payout.providerStatus =
          providerStatus
        payout.failureReason =
          failureReason ??
          'Paystack transfer was reversed'
        payout.reversedAt = now
        processed = true
      }
    }

    if (processed) {
      await payout.save()
    }

    return {
      payoutId:
        payout._id.toString(),
      reference:
        payout.reference,
      eventId:
        payout.event.toString(),
      status:
        payout.status,
      providerStatus:
        payout.providerStatus,
      transferCode:
        payout.transferCode,
      processed,
    }
  }
}

export const payoutService = new PayoutService()
