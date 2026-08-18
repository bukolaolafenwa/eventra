import { Request, Response } from 'express'
import mongoose from 'mongoose'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import {
  buildPaginationMeta,
  getPagination,
  sanitizeOrganizerProfile,
  sanitizeUser,
} from '../lib/utils.js'
import User, {
  IOrganizerNotificationPreferences,
  IOrganizerProfile,
} from '../models/user.js'
import Event from '../models/event.js'
import Order from '../models/order.js'
import Ticket from '../models/ticket.js'
import { paystackService } from '../services/paystack.service.js'

/**
 * Create or update the caller's organizer profile (org info + bank
 * details). This is the wizard's "save as you go" endpoint — each step
 * (About your organization, Bank account) and "Save & exit" all call this
 * with just the fields that step collected, so it only ever merges over
 * the existing profile rather than replacing it.
 *
 * Submitting new bank details on an already-*approved* profile resets it
 * to 'pending' — an admin must re-verify before payouts resume. Editing
 * anything else, or editing while still in 'draft' (i.e. the wizard isn't
 * submitted yet), never changes approvalStatus — that only moves forward
 * via submitOrganizerProfileForReview below.
 */
export const upsertOrganizerProfile =
  tryCatchWrapper(
    async (
      req: Request,
      res: Response,
    ) => {
      const user = await User.findById(
        req.session.userId,
      )

      if (!user) {
        return sendTsRestError(
          res,
          404,
          'User not found',
        )
      }

      const existing =
        user.organizerProfile

      const submittedBankCode =
        req.body.bankCode as
          | string
          | undefined

      const submittedAccountNumber =
        req.body.accountNumber as
          | string
          | undefined

      const isBankUpdate =
        submittedBankCode !== undefined ||
        submittedAccountNumber !==
          undefined

      const bankDetailsChanged =
        isBankUpdate &&
        (submittedBankCode !==
          existing?.bankCode ||
          submittedAccountNumber !==
            existing?.accountNumber)

      const nextApprovalStatus:
        IOrganizerProfile['approvalStatus'] =
        existing?.approvalStatus ===
          'approved' &&
        bankDetailsChanged
          ? 'pending'
          : existing?.approvalStatus ??
            'draft'

      let bankName =
        existing?.bankName
      let bankCode =
        existing?.bankCode
      let accountNumber =
        existing?.accountNumber
      let accountName =
        existing?.accountName
      let paystackRecipientCode =
        existing?.paystackRecipientCode

      /*
       * Resolve and provision the account again during the save request.
       * The earlier /resolve-account call is only a frontend preview and
       * is not trusted as proof that these submitted details are valid.
       */
      if (isBankUpdate) {
        bankCode = submittedBankCode!
        accountNumber =
          submittedAccountNumber!

        const resolvedAccount =
          await paystackService.resolveAccount({
            accountNumber,
            bankCode,
          })

        const recipient =
          await paystackService
            .createTransferRecipient({
              name:
                resolvedAccount.accountName,
              accountNumber:
                resolvedAccount.accountNumber,
              bankCode,
              metadata: {
                organizerId:
                  user._id.toString(),
              },
            })

        if (
          !recipient.active ||
          recipient.currency !== 'NGN'
        ) {
          return sendTsRestError(
            res,
            502,
            'Paystack did not create an active NGN transfer recipient',
          )
        }

        if (
          recipient.accountNumber !==
            resolvedAccount.accountNumber ||
          recipient.bankCode !== bankCode
        ) {
          return sendTsRestError(
            res,
            502,
            'Paystack returned transfer recipient details that do not match the verified account',
          )
        }

        bankName =
          recipient.bankName
        accountName =
          recipient.accountName ||
          resolvedAccount.accountName
        accountNumber =
          recipient.accountNumber
        bankCode =
          recipient.bankCode
        paystackRecipientCode =
          recipient.recipientCode
      }

      const isPayoutReady = Boolean(
        bankName &&
          bankCode &&
          accountNumber &&
          accountName &&
          paystackRecipientCode,
      )

      user.organizerProfile = {
        businessName:
          req.body.businessName ??
          existing?.businessName,
        category:
          req.body.category ??
          existing?.category,
        city:
          req.body.city ??
          existing?.city,
        contactPhone:
          req.body.contactPhone ??
          existing?.contactPhone,
        publicEmail:
          req.body.publicEmail ??
          existing?.publicEmail,
        bio:
          req.body.bio ??
          existing?.bio,

        bankName,
        bankCode,
        accountNumber,
        accountName,
        isPayoutReady,
        paystackRecipientCode,

        approvalStatus:
          nextApprovalStatus,
        agreedToTerms:
          req.body.agreedToTerms ??
          existing?.agreedToTerms ??
          false,
        submittedAt:
          existing?.submittedAt,
      }

      await user.save()

      return sendTsRestSuccess(
        res,
        200,
        {
          success: true,
          message:
            isBankUpdate
              ? 'Organizer profile and payout account updated'
              : 'Organizer profile updated',
          body: sanitizeUser(
            user.toObject(),
          ),
        },
      )
    },
  )

const REQUIRED_FOR_SUBMISSION: { field: keyof IOrganizerProfile; label: string }[] = [
  { field: 'businessName', label: 'Organization name' },
  { field: 'category', label: 'Category' },
  { field: 'city', label: 'City' },
  { field: 'contactPhone', label: 'Contact phone' },
  { field: 'publicEmail', label: 'Public email' },
  { field: 'bio', label: 'Short bio' },
]

/**
 * Step 3 of the wizard ("Review & submit"). Bank details are deliberately
 * NOT required here — the Figma lets organizers skip that step and add it
 * later from settings; only paid events need it to go live, per
 * event.controller.ts's paid-event gate.
 */
export const submitOrganizerProfileForReview = tryCatchWrapper(async (req: Request, res: Response) => {
  const user = await User.findById(req.session.userId)
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  const profile = user.organizerProfile
  const missing = REQUIRED_FOR_SUBMISSION.filter(({ field }) => !profile?.[field]).map(({ label }) => label)
  if (missing.length > 0) {
    return sendTsRestError(res, 400, `Finish these before submitting: ${missing.join(', ')}`)
  }

  if (!req.body.agreedToTerms && !profile!.agreedToTerms) {
    return sendTsRestError(res, 400, 'You must agree to the Organizer Terms and Payout Policy')
  }

  user.role = 'organizer'
  user.organizerProfile!.agreedToTerms = true
  user.organizerProfile!.approvalStatus = 'pending'
  user.organizerProfile!.submittedAt = new Date()
  await user.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Submitted for review',
    body: sanitizeUser(user.toObject()),
  })
})

export const getOrganizerProfile = tryCatchWrapper(async (req: Request, res: Response) => {
  const user = await User.findById(req.session.userId).lean()
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Organizer profile fetched',
    body: sanitizeOrganizerProfile(
    user.organizerProfile,
),
  })
})

/**
 * Returns the complete organizer Settings-page state without exposing the
 * full bank account number or Paystack recipient code.
 */
export const getOrganizerSettings =
  tryCatchWrapper(
    async (
      req: Request,
      res: Response,
    ) => {
      const user =
        await User.findById(
          req.session.userId,
        ).lean()

      if (!user) {
        return sendTsRestError(
          res,
          404,
          'User not found',
        )
      }

      const profile =
        user.organizerProfile

      const notifications = {
        newTicketSalesAndRsvps:
          user
            .organizerNotificationPreferences
            ?.newTicketSalesAndRsvps ??
          false,
        dailySalesSummary:
          user
            .organizerNotificationPreferences
            ?.dailySalesSummary ??
          false,
        payoutConfirmations:
          user
            .organizerNotificationPreferences
            ?.payoutConfirmations ??
          false,
        eventApprovals:
          user
            .organizerNotificationPreferences
            ?.eventApprovals ??
          false,
      }

      return sendTsRestSuccess(
        res,
        200,
        {
          success: true,
          message:
            'Organizer settings fetched',
          body: {
            verification: {
              status:
                profile?.approvalStatus ??
                'draft',
              isPayoutReady:
                profile?.isPayoutReady ??
                false,
              canReceivePayouts:
                profile?.approvalStatus ===
                  'approved' &&
                profile.isPayoutReady,
            },

            organizationProfile: profile
              ? {
                  businessName:
                    profile.businessName,
                  category:
                    profile.category,
                  city: profile.city,
                  contactPhone:
                    profile.contactPhone,
                  publicEmail:
                    profile.publicEmail,
                  bio: profile.bio,
                }
              : null,

            payoutAccount:
              profile?.accountNumber
                ? {
                    bankName:
                      profile.bankName,
                    accountName:
                      profile.accountName,
                    accountNumberLast4:
                      profile.accountNumber.slice(
                        -4,
                      ),
                    isPayoutReady:
                      profile.isPayoutReady,
                  }
                : null,

            notifications,
          },
        },
      )
    },
  )

/**
 * Partially updates the four organizer notification switches shown on the
 * Settings page. Unsubmitted preferences retain their existing values.
 */
export const updateOrganizerNotificationPreferences =
  tryCatchWrapper(
    async (
      req: Request,
      res: Response,
    ) => {
      const input =
        req.body as Partial<IOrganizerNotificationPreferences>

      const user =
        await User.findById(
          req.session.userId,
        )

      if (!user) {
        return sendTsRestError(
          res,
          404,
          'User not found',
        )
      }

      const existing =
        user.organizerNotificationPreferences

      user.organizerNotificationPreferences =
        {
          newTicketSalesAndRsvps:
            input.newTicketSalesAndRsvps ??
            existing
              ?.newTicketSalesAndRsvps ??
            false,
          dailySalesSummary:
            input.dailySalesSummary ??
            existing
              ?.dailySalesSummary ??
            false,
          payoutConfirmations:
            input.payoutConfirmations ??
            existing
              ?.payoutConfirmations ??
            false,
          eventApprovals:
            input.eventApprovals ??
            existing
              ?.eventApprovals ??
            false,
        }

      await user.save()

      return sendTsRestSuccess(
        res,
        200,
        {
          success: true,
          message:
            'Organizer notification preferences updated',
          body:
            user.organizerNotificationPreferences,
        },
      )
    },
  )

/**
 * Nigerian bank list for the "Where should we send your money?" step —
 * cached in-process for a day since Paystack's bank list is effectively
 * static, so this almost never actually hits their API.
 */
export const listBanks = tryCatchWrapper(async (req: Request, res: Response) => {
  const banks = await paystackService.listBanks()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Banks fetched',
    body: banks,
  })
})

/**
 * Confirms the account holder's name for a bank account before it's saved
 * to the organizer's profile, so the form can fill Account Holder Name
 * from a verified source rather than letting the organizer type it
 * themselves (and possibly typo their own payout destination).
 */
export const resolveBankAccount = tryCatchWrapper(async (req: Request, res: Response) => {
  const { accountNumber, bankCode } = req.body as { accountNumber: string; bankCode: string }

  try {
    const account = await paystackService.resolveAccount({ accountNumber, bankCode })
    return sendTsRestSuccess(res, 200, {
      success: true,
      message: 'Account resolved',
      body: account,
    })
  } catch (error: any) {
    return sendTsRestError(res, 400, error.message || 'Could not resolve this account')
  }
})

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Pending',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  postponed: 'Postponed',
  suspended: 'Suspended',
  sold_out: 'Sold out',
  live: 'Live',
  past: 'Past',
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null // undefined % change from a zero baseline — let the client show "New"
  return Math.round(((current - previous) / previous) * 100)
}

/**
 * Powers the dashboard's Overview page: the 4 stat cards (tickets sold,
 * revenue, live events, payout due) and the "Recent events" table.
 */
export const getOrganizerOverview = tryCatchWrapper(async (req: Request, res: Response) => {
  const organizerId = req.session.userId
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - THIRTY_DAYS_MS)
  const sixtyDaysAgo = new Date(now.getTime() - 2 * THIRTY_DAYS_MS)

  const [events, recentEvents, currentPeriodAgg, previousPeriodAgg, payoutDueAgg] = await Promise.all([
    Event.find({ organizer: organizerId }).select('status').lean(),
    Event.find({ organizer: organizerId })
      .select('title slug status type startDate capacity ticketsSoldCount reservationsCount revenueTotal endDate')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
    Order.aggregate([
      { $match: { status: { $in: ['paid', 'partially_refunded'] }, paidAt: { $gte: thirtyDaysAgo } } },
      { $lookup: { from: 'events', localField: 'event', foreignField: '_id', as: 'eventDoc' } },
      { $unwind: '$eventDoc' },
      { $match: { 'eventDoc.organizer': new mongoose.Types.ObjectId(organizerId) } },
      { $group: { _id: null, ticketsSold: { $sum: { $sum: '$items.quantity' } }, revenue: { $sum: '$subtotal' } } },
    ]),
    Order.aggregate([
      { $match: { status: { $in: ['paid', 'partially_refunded'] }, paidAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } } },
      { $lookup: { from: 'events', localField: 'event', foreignField: '_id', as: 'eventDoc' } },
      { $unwind: '$eventDoc' },
      { $match: { 'eventDoc.organizer': new mongoose.Types.ObjectId(organizerId) } },
      { $group: { _id: null, ticketsSold: { $sum: { $sum: '$items.quantity' } }, revenue: { $sum: '$subtotal' } } },
    ]),
    // Held for a few days after the event per the standard payout-delay
    // policy — only orders on events that have already ended are "due".
    Order.aggregate<{ amountDue: number }>([
  {
    $match: {
      status: 'paid',
    },
  },
  {
    $lookup: {
      from: 'events',
      localField: 'event',
      foreignField: '_id',
      as: 'eventDoc',
    },
  },
  {
    $unwind: '$eventDoc',
  },
  {
    $match: {
      'eventDoc.organizer':
        new mongoose.Types.ObjectId(
          organizerId,
        ),
      'eventDoc.endDate': {
        $lt: now,
      },
    },
  },
  {
    $group: {
      _id: null,
      amountDue: {
        $sum: {
          $subtract: [
            '$subtotal',
            '$serviceFee',
          ],
        },
      },
    },
  },
]),
  ])

  const liveEvents = events.filter(e => e.status === 'approved').length

  const currentTicketsSold = currentPeriodAgg[0]?.ticketsSold ?? 0
  const currentRevenue = currentPeriodAgg[0]?.revenue ?? 0
  const previousTicketsSold = previousPeriodAgg[0]?.ticketsSold ?? 0
  const previousRevenue = previousPeriodAgg[0]?.revenue ?? 0

  // PRD Section 8: Eventra retains 5% commission, organizer gets the remainder.
  const payoutDue =
  payoutDueAgg[0]?.amountDue ?? 0

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Overview fetched',
    body: {
      ticketsSold: { value: currentTicketsSold, changePercent: percentChange(currentTicketsSold, previousTicketsSold) },
      revenue: { value: currentRevenue, changePercent: percentChange(currentRevenue, previousRevenue) },
      liveEvents,
      payoutDue,
      recentEvents: recentEvents.map(event => ({
        title: event.title,
        slug: event.slug,
        type: event.type,
        startDate: event.startDate,
        soldCount: event.type === 'free' ? event.reservationsCount : event.ticketsSoldCount,
        capacity: event.capacity ?? null,
        revenue: event.revenueTotal,
        statusLabel: STATUS_LABEL[event.status] ?? event.status,
      })),
    },
  })
})

/**
 * Lists completed paid orders across the organizer's events, with
 * a payout-status breakdown for the dashboard's Payouts page.
 * Partially refunded orders remain excluded until refund
 * reconciliation is implemented.
 */
export const listOrganizerPayouts = tryCatchWrapper(async (req: Request, res: Response) => {
  const organizerId = req.session.userId
  const { page, limit, skip } = getPagination(req.query)
  const now = new Date()

  const organizerEvents = await Event.find({ organizer: organizerId }).select('_id title slug endDate').lean()
  const eventIds = organizerEvents.map(e => e._id)
  const eventById = new Map(organizerEvents.map(e => [e._id.toString(), e]))

  const filter = {
  event: {
    $in: eventIds,
  },
  status: 'paid' as const,
}

  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ paidAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments(filter),
  ])

  const payouts = orders.map(order => {
    const event = eventById.get(order.event.toString())
    // Matches the payout-delay policy used in getOrganizerOverview above —
    // due once the event has ended, held until then.
    const isDue = event?.endDate ? event.endDate.getTime() < now.getTime() : false

    return {
      orderId: order._id,
      orderNumber: order.orderNumber,
      eventTitle: event?.title ?? 'Unknown event',
      eventSlug: event?.slug,
      grossAmount: order.subtotal,
      commission: order.serviceFee,
      netAmount: order.subtotal - order.serviceFee,
      paidAt: order.paidAt,
      payoutStatus: isDue ? 'due' : 'pending',
    }
  })

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Payouts fetched',
    body: { payouts, meta: buildPaginationMeta(page, limit, total) },
  })
})