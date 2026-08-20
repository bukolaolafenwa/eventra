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
import Payout from '../models/payout.js'
import Ticket from '../models/ticket.js'
import TicketType from '../models/tickettype.js'
import { paystackService } from '../services/paystack.service.js'
import { deriveEventDisplayStatus } from '../lib/eventStatus.js'

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
 * Alias for sever-a's reference client, which calls a narrow
 * GET /organizers/notification-preferences returning just the four
 * notification switches (field name: newSalesRsvps), rather than
 * this team's broader GET /settings response. Reads the same underlying
 * user.organizerNotificationPreferences document that getOrganizerSettings
 * above does — just reshaped to match the reference client's exact
 * response contract, including renaming newTicketSalesAndRsvps to
 * newSalesRsvps so an existing frontend built against sever-a doesn't
 * need its own field-name mapping.
 */
export const getOrganizerNotificationPreferences = tryCatchWrapper(async (req: Request, res: Response) => {
  const user = await User.findById(req.session.userId).select('organizerNotificationPreferences').lean()
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  const prefs = user.organizerNotificationPreferences

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Notification preferences fetched',
    body: {
      newSalesRsvps: prefs?.newTicketSalesAndRsvps ?? false,
      dailySalesSummary: prefs?.dailySalesSummary ?? false,
      payoutConfirmations: prefs?.payoutConfirmations ?? false,
      eventApprovals: prefs?.eventApprovals ?? false,
    },
  })
})

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
const SIXTY_DAYS_MS = 2 * THIRTY_DAYS_MS

// null (not 0%) when there's no prior-period baseline to compare against —
// "+100%" off a true zero is misleading, so the client shows no trend at
// all in that case rather than a made-up number.
function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

/**
 * "Tickets by type" donut — paid ticket tiers only (Regular/VIP/Table
 * etc). Free-event RSVPs have no ticketType to break down by (pricePaid
 * is 0 and ticketType is unset on those), and mixing them in would just
 * add a meaningless "Free" wedge to what's meant to show ticket-tier mix.
 */
async function buildTicketsByType(
  eventIds: mongoose.Types.ObjectId[]
): Promise<{ name: string; count: number; percentage: number }[]> {
  const rows = await Ticket.aggregate([
    { $match: { event: { $in: eventIds }, pricePaid: { $gt: 0 }, status: { $ne: 'cancelled' } } },
    { $group: { _id: '$ticketType', count: { $sum: 1 } } },
    { $lookup: { from: TicketType.collection.name, localField: '_id', foreignField: '_id', as: 'ticketType' } },
    { $unwind: { path: '$ticketType', preserveNullAndEmptyArrays: true } },
    { $project: { name: { $ifNull: ['$ticketType.name', 'Other'] }, count: 1 } },
    { $sort: { count: -1 } },
  ])

  const total = rows.reduce((sum, row) => sum + row.count, 0)
  if (total === 0) return []

  return rows.map(row => ({ name: row.name, count: row.count, percentage: Math.round((row.count / total) * 100) }))
}

/**
 * Revenue-over-time line chart. "Amount" is the organizer's net take
 * (subtotal minus Eventra's serviceFee), computed the same way
 * getEventDashboard's payout figure is, not gross ticket sales.
 */
async function buildRevenueSeries(
  eventIds: mongoose.Types.ObjectId[],
  period: string
): Promise<{ label: string; amount: number }[]> {
  const normalizedPeriod = period === '7d' || period === '1m' ? period : '30d'
  const now = new Date()

  if (normalizedPeriod === '1m') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const orders = await Order.find({
      event: { $in: eventIds },
      status: { $in: ['paid', 'partially_refunded'] },
      createdAt: { $gte: monthStart },
    })
      .select('subtotal serviceFee createdAt')
      .lean()

    const weekCount = Math.ceil((now.getDate() + monthStart.getDay()) / 7)
    const buckets = Array.from({ length: weekCount }, (_, i) => ({ label: `W${i + 1}`, amount: 0 }))

    for (const order of orders) {
      const dayOfMonth = new Date(order.createdAt).getDate()
      const weekIndex = Math.min(Math.floor((dayOfMonth - 1) / 7), buckets.length - 1)
      buckets[weekIndex].amount += order.subtotal - order.serviceFee
    }
    return buckets
  }

  const days = normalizedPeriod === '7d' ? 7 : 30
  const startDate = new Date(now)
  startDate.setDate(startDate.getDate() - (days - 1))
  startDate.setHours(0, 0, 0, 0)

  const orders = await Order.find({
    event: { $in: eventIds },
    status: { $in: ['paid', 'partially_refunded'] },
    createdAt: { $gte: startDate },
  })
    .select('subtotal serviceFee createdAt')
    .lean()

  const buckets = new Map<string, number>()
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate)
    d.setDate(d.getDate() + i)
    buckets.set(d.toISOString().slice(0, 10), 0)
  }
  for (const order of orders) {
    const key = new Date(order.createdAt).toISOString().slice(0, 10)
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + (order.subtotal - order.serviceFee))
  }

  return Array.from(buckets.entries()).map(([date, amount]) => ({ label: date, amount }))
}

/**
 * Powers the dashboard's Overview page: the 4 stat cards (tickets sold,
 * revenue, live events, payout due), the tickets-by-type donut, the
 * revenue line chart, and the "Recent events" table.
 *
 * payoutDue/nextPayoutInDays are sourced from this team's dedicated Payout
 * collection (see models/payout.ts, services/payout.service.ts) — a
 * different, more mature design than the reference implementation's
 * Order-embedded payoutStatus/organizerEarnings fields, which don't exist
 * here. A Payout document only exists once an admin has actually initiated
 * one (initiateEventPayout in admin.controller.ts) — earnings on events
 * that haven't reached that step yet aren't reflected in payoutDue below,
 * same scope as what the dedicated Payout collection itself tracks.
 */
export const getOrganizerOverview = tryCatchWrapper(async (req: Request, res: Response) => {
  const organizerId = req.session.userId
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - THIRTY_DAYS_MS)
  const sixtyDaysAgo = new Date(now.getTime() - SIXTY_DAYS_MS)

  const events = await Event.find({ organizer: organizerId })
    .select('title slug coverImage type status startDate endDate capacity ticketsSoldCount reservationsCount revenueTotal category')
    .populate('category', 'name')
    .sort({ createdAt: -1 })
    .lean()

  let ticketsSold = 0
  let revenue = 0
  let liveCount = 0

  const recentEvents = events.slice(0, 6).map(event => {
    const soldCount = event.type === 'free' ? event.reservationsCount : event.ticketsSoldCount
    const displayStatus = deriveEventDisplayStatus(event)
    return {
      _id: event._id,
      title: event.title,
      slug: event.slug,
      coverImage: event.coverImage,
      category: (event.category as any)?.name,
      startDate: event.startDate,
      soldCount,
      capacity: event.capacity ?? null,
      status: displayStatus,
      statusLabel: STATUS_LABEL[displayStatus] ?? displayStatus,
    }
  })

  for (const event of events) {
    ticketsSold += event.ticketsSoldCount + event.reservationsCount
    revenue += event.revenueTotal
    if (deriveEventDisplayStatus(event) === 'live') liveCount += 1
  }

  const eventIds = events.map(event => event._id)

  const [pendingPayouts, nextPendingPayout, periodTotals, ticketsByType, revenueSeries] = await Promise.all([
    Payout.aggregate<{ amount: number }>([
      { $match: { organizer: new mongoose.Types.ObjectId(organizerId), status: { $in: ['pending', 'processing', 'otp_required'] } } },
      { $group: { _id: null, amount: { $sum: '$netAmount' } } },
    ]),
    Payout.findOne({ organizer: organizerId, status: { $in: ['pending', 'processing', 'otp_required'] } })
      .sort({ eligibleAt: 1 })
      .select('eligibleAt')
      .lean(),
    // Powers "vs last month" on the tickets sold / revenue cards — two
    // real 30-day windows from paid orders, not a made-up figure.
    Order.aggregate([
      {
        $match: {
          event: { $in: eventIds },
          status: { $in: ['paid', 'partially_refunded'] },
          createdAt: { $gte: sixtyDaysAgo },
        },
      },
      {
        $group: {
          _id: { $cond: [{ $gte: ['$createdAt', thirtyDaysAgo] }, 'current', 'previous'] },
          tickets: { $sum: { $sum: '$items.quantity' } },
          revenue: { $sum: { $subtract: ['$subtotal', '$serviceFee'] } },
        },
      },
    ]),
    buildTicketsByType(eventIds),
    buildRevenueSeries(eventIds, (req.query.period as string) ?? '30d'),
  ])

  const payoutDue = pendingPayouts[0]?.amount ?? 0

  let nextPayoutInDays: number | null = null
  if (nextPendingPayout?.eligibleAt) {
    const msRemaining = new Date(nextPendingPayout.eligibleAt).getTime() - Date.now()
    nextPayoutInDays = Math.max(Math.ceil(msRemaining / (24 * 60 * 60 * 1000)), 0)
  }

  const currentPeriod = periodTotals.find(p => p._id === 'current') ?? { tickets: 0, revenue: 0 }
  const previousPeriod = periodTotals.find(p => p._id === 'previous') ?? { tickets: 0, revenue: 0 }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Overview fetched',
    body: {
      ticketsSold,
      ticketsSoldChangePct: percentChange(currentPeriod.tickets, previousPeriod.tickets),
      revenue,
      revenueChangePct: percentChange(currentPeriod.revenue, previousPeriod.revenue),
      liveEventsCount: liveCount,
      payoutDue,
      nextPayoutInDays,
      recentEvents,
      revenueSeries,
      ticketsByType,
    },
  })
})

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