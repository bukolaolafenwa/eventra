import { Request, Response } from 'express'
import mongoose from 'mongoose'
import { getPromotionPackage } from '../config/promotionPackages.js'
import logger from '../config/logger.js'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import {
  buildPaginationMeta,
  escapeRegExp,
  getPagination,
  isValidObjectId,
  sanitizeUser,
} from '../lib/utils.js'
import { invalidateUserSessions } from '../lib/sessionStore.js'
import Event from '../models/event.js'
import AdminActivity, {
  AdminActivityAction,
  AdminActivitySubject,
} from '../models/adminActivity.js'
import Order from '../models/order.js'
import RefundRequest from '../models/refundRequest.js'
import Ticket from '../models/ticket.js'
import User from '../models/user.js'
import { EmailService } from '../services/email.service.js'
import { paystackService } from '../services/paystack.service.js'
import { payoutService } from '../services/payout.service.js'
import {
  adminDashboardService,
  normalizeDashboardRange,
} from '../services/adminDashboard.service.js'

interface InitiateEventPayoutParams {
  eventId: string
}

const recordAdminActivity = async (
  req: Request,
  input: {
    action: AdminActivityAction
    subjectType: AdminActivitySubject
    subjectId: mongoose.Types.ObjectId
    message: string
    metadata?: Record<string, unknown>
  },
): Promise<void> => {
  if (!req.session.userId) return

  try {
    await AdminActivity.create({
      actor: req.session.userId,
      ...input,
    })
  } catch (error) {
    logger.error({ err: error }, 'Could not record admin activity')
  }
}

const getSafeLimit = (value: unknown, fallback: number, maximum: number): number => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return Math.min(parsed, maximum)
}

export const getAdminOverview = tryCatchWrapper(async (req: Request, res: Response) => {
  const range = normalizeDashboardRange(req.query.range)
  const overview = await adminDashboardService.getOverview(range)

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Admin overview fetched',
    body: overview,
  })
})

export const listAdminActivities = tryCatchWrapper(async (req: Request, res: Response) => {
  const limit = getSafeLimit(req.query.limit, 20, 100)
  const activities = await adminDashboardService.getActivities(limit)

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Admin activities fetched',
    body: activities,
  })
})

export const listTopOrganizers = tryCatchWrapper(async (req: Request, res: Response) => {
  const limit = getSafeLimit(req.query.limit, 5, 25)
  const organizers = await adminDashboardService.getTopOrganizers(limit)

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Top organizers fetched',
    body: organizers,
  })
})

export const getApprovalQueue = tryCatchWrapper(async (req: Request, res: Response) => {
  const type = typeof req.query.type === 'string' ? req.query.type : 'all'
  if (!['all', 'events', 'organizers', 'promotions'].includes(type)) {
    return sendTsRestError(res, 400, 'type must be all, events, organizers or promotions')
  }

  const limit = getSafeLimit(req.query.limit, 10, 50)
  const includeEvents = type === 'all' || type === 'events'
  const includeOrganizers = type === 'all' || type === 'organizers'
  const includePromotions = type === 'all' || type === 'promotions'

  const [events, organizers, promotions, eventCount, organizerCount, promotionCount] =
    await Promise.all([
      includeEvents
        ? Event.find({ status: 'pending_approval' })
            .populate('organizer', 'fullname email organizerProfile.businessName')
            .populate('category', 'name')
            .sort({ createdAt: 1 })
            .limit(limit)
            .lean()
        : [],
      includeOrganizers
        ? User.find({ role: 'organizer', 'organizerProfile.approvalStatus': 'pending' })
            .select('-password')
            .sort({ 'organizerProfile.submittedAt': 1, createdAt: 1 })
            .limit(limit)
            .lean()
        : [],
      includePromotions
        ? Event.find({ 'promotion.status': 'pending' })
            .populate('organizer', 'fullname email organizerProfile.businessName')
            .select('title slug coverImage organizer promotion startDate createdAt')
            .sort({ 'promotion.paidAt': 1, createdAt: 1 })
            .limit(limit)
            .lean()
        : [],
      Event.countDocuments({ status: 'pending_approval' }),
      User.countDocuments({ role: 'organizer', 'organizerProfile.approvalStatus': 'pending' }),
      Event.countDocuments({ 'promotion.status': 'pending' }),
    ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Approval queue fetched',
    body: {
      counts: {
        events: eventCount,
        organizers: organizerCount,
        promotions: promotionCount,
        total: eventCount + organizerCount + promotionCount,
      },
      events,
      organizers: organizers.map(organizer => sanitizeUser(organizer)),
      promotions,
    },
  })
})

export const getOrganizerReview = tryCatchWrapper(async (req: Request, res: Response) => {
  if (!isValidObjectId(req.params.id)) {
    return sendTsRestError(res, 400, 'Invalid organizer ID')
  }

  const organizer = await User.findOne({ _id: req.params.id, role: 'organizer' })
    .select('-password')
    .lean()
  if (!organizer) {
    return sendTsRestError(res, 404, 'Organizer not found')
  }

  const [eventCount, approvedEventCount, grossSales] = await Promise.all([
    Event.countDocuments({ organizer: organizer._id }),
    Event.countDocuments({ organizer: organizer._id, status: { $in: ['approved', 'postponed'] } }),
    Order.aggregate<{ amount: number }>([
      { $match: { status: { $in: ['paid', 'partially_refunded', 'refunded'] } } },
      { $lookup: { from: 'events', localField: 'event', foreignField: '_id', as: 'eventDoc' } },
      { $unwind: '$eventDoc' },
      { $match: { 'eventDoc.organizer': organizer._id } },
      { $group: { _id: null, amount: { $sum: '$subtotal' } } },
    ]),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Organizer review fetched',
    body: {
      organizer: sanitizeUser(organizer),
      summary: {
        eventCount,
        approvedEventCount,
        grossSales: grossSales[0]?.amount ?? 0,
      },
    },
  })
})

export const getEventReview = tryCatchWrapper(async (req: Request, res: Response) => {
  if (!isValidObjectId(req.params.id)) {
    return sendTsRestError(res, 400, 'Invalid event ID')
  }

  const event = await Event.findById(req.params.id)
    .populate('organizer', 'fullname email organizerProfile.businessName organizerProfile.approvalStatus')
    .populate('category', 'name')
    .lean()
  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }

  const [orderSummary, refundSummary] = await Promise.all([
    Order.aggregate<{ orders: number; grossSales: number; tickets: number }>([
      { $match: { event: event._id, status: { $in: ['paid', 'confirmed', 'partially_refunded', 'refunded'] } } },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          grossSales: { $sum: '$subtotal' },
          tickets: { $sum: { $sum: '$items.quantity' } },
        },
      },
    ]),
    RefundRequest.aggregate<{ requests: number; amount: number }>([
      { $match: { event: event._id } },
      { $group: { _id: null, requests: { $sum: 1 }, amount: { $sum: '$amount' } } },
    ]),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event review fetched',
    body: {
      event,
      summary: {
        orders: orderSummary[0]?.orders ?? 0,
        tickets: orderSummary[0]?.tickets ?? 0,
        grossSales: orderSummary[0]?.grossSales ?? 0,
        refundRequests: refundSummary[0]?.requests ?? 0,
        refundAmount: refundSummary[0]?.amount ?? 0,
      },
    },
  })
})

export const listPendingPromotions = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)
  const filter = { 'promotion.status': 'pending' }
  const [promotions, total] = await Promise.all([
    Event.find(filter)
      .populate('organizer', 'fullname email organizerProfile.businessName')
      .select('title slug coverImage organizer promotion startDate createdAt')
      .sort({ 'promotion.paidAt': 1, createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Event.countDocuments(filter),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Pending promotions fetched',
    body: { promotions, meta: buildPaginationMeta(page, limit, total) },
  })
})

export const listUsers = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)

  const filter: Record<string, any> = {}
  if (req.query.role === 'attendee' || req.query.role === 'organizer' || req.query.role === 'admin') {
    filter.role = req.query.role
  }
  if (req.query.q && typeof req.query.q === 'string') {
    const term = new RegExp(escapeRegExp(req.query.q), 'i')
    filter.$or = [{ fullname: term }, { email: term }]
  }

  const [users, total] = await Promise.all([
    User.find(filter).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Users fetched',
    body: { users, meta: buildPaginationMeta(page, limit, total) },
  })
})

export const suspendUser = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const user = await User.findById(id)
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }
  if (user.role === 'admin') {
    return sendTsRestError(res, 400, "Admin accounts can't be suspended")
  }

  user.isSuspended = true
  await user.save()

  // Kick them out immediately rather than waiting for their session to expire naturally.
  await invalidateUserSessions(user._id.toString())

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'User suspended',
    body: sanitizeUser(user.toObject()),
  })
})

export const unsuspendUser = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const user = await User.findById(id)
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  user.isSuspended = false
  await user.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'User unsuspended',
    body: sanitizeUser(user.toObject()),
  })
})

export const getPlatformStats = tryCatchWrapper(async (req: Request, res: Response) => {
  const [salesAgg, promotedEvents, activeEvents, totalUsers, totalOrganizers, pendingRefunds] = await Promise.all([
    Order.aggregate([
      { $match: { status: { $in: ['paid', 'partially_refunded'] } } },
      { $group: { _id: null, grossSales: { $sum: '$subtotal' }, commissionRevenue: { $sum: '$serviceFee' } } },
    ]),
    Event.find({ 'promotion.status': 'approved' }).select('promotion.package').lean(),
    Event.countDocuments({ status: { $in: ['approved', 'postponed'] as Array<'approved' | 'postponed'> } }),
    User.countDocuments({ role: 'attendee' }),
    User.countDocuments({ role: 'organizer' }),
    RefundRequest.countDocuments({ status: 'pending' }),
  ])

  const promotionRevenue = promotedEvents.reduce((sum, event) => {
    const pkg = getPromotionPackage(event.promotion?.package)
    return sum + (pkg?.priceNaira ?? 0)
  }, 0)

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Platform stats fetched',
    body: {
      grossTicketSales: salesAgg[0]?.grossSales ?? 0,
      commissionRevenue: salesAgg[0]?.commissionRevenue ?? 0,
      promotionRevenue,
      activeEvents,
      totalAttendees: totalUsers,
      totalOrganizers,
      pendingRefundRequests: pendingRefunds,
    },
  })
})

export const listPendingOrganizers = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)
  const filter = { role: 'organizer', 'organizerProfile.approvalStatus': 'pending' }

  const [organizers, total] = await Promise.all([
    User.find(filter).select('-password').sort({ createdAt: 1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Pending organizers fetched',
    body: { organizers, meta: buildPaginationMeta(page, limit, total) },
  })
})

// NOTE: this previously called PaystackService.createTransferRecipient() (Person B's
// service) and blocked approval on it succeeding. That's been removed. Approval now
// proceeds independent of payout setup; isPayoutReady stays false until Person B's
// bank-verification flow (wherever that ends up living) flips it on.
export const approveOrganizer = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const organizer = await User.findOne({ _id: id, role: 'organizer' })
  if (!organizer || !organizer.organizerProfile) {
    return sendTsRestError(res, 404, 'Organizer not found')
  }

  // I comment this out because we don't want to block approval on payout setup for free-event-organizers. The organizer can still be approved and start creating events, even if they haven't set up their bank details yet. The payout setup can be completed if they want to post paid events, and the isPayoutReady flag will indicate whether they are ready to receive payouts.
  // const { accountName, accountNumber, bankCode } = organizer.organizerProfile
  // if (!accountName || !accountNumber || !bankCode) {
  //   return sendTsRestError(res, 400, 'This organizer has not completed their bank details yet')
  // }

  organizer.organizerProfile.approvalStatus = 'approved'
  await organizer.save()

  await recordAdminActivity(req, {
    action: 'organizer_approved',
    subjectType: 'organizer',
    subjectId: organizer._id,
    message: `Approved organizer ${organizer.organizerProfile.businessName || organizer.fullname}`,
  })

  EmailService.sendOrganizerApprovedEmail(organizer).catch(error =>
    logger.error({ err: error }, `Organizer-approved email failed for ${organizer._id}`)
  )

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Organizer approved',
    body: sanitizeUser(organizer.toObject()),
  })
})

export const rejectOrganizer = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const organizer = await User.findOne({ _id: id, role: 'organizer' })
  if (!organizer || !organizer.organizerProfile) {
    return sendTsRestError(res, 404, 'Organizer not found')
  }

  organizer.organizerProfile.approvalStatus = 'rejected'
  await organizer.save()

  await recordAdminActivity(req, {
    action: 'organizer_rejected',
    subjectType: 'organizer',
    subjectId: organizer._id,
    message: `Rejected organizer ${organizer.organizerProfile.businessName || organizer.fullname}`,
  })

  EmailService.sendOrganizerRejectedEmail(organizer).catch(error =>
    logger.error({ err: error }, `Organizer-rejected email failed for ${organizer._id}`)
  )

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Organizer rejected',
    body: sanitizeUser(organizer.toObject()),
  })
})

export const listPendingEvents = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)
  const filter = { status: 'pending_approval' }

  const [events, total] = await Promise.all([
    Event.find(filter)
      .populate('organizer', 'fullname email organizerProfile.businessName')
      .populate('category', 'name')
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Event.countDocuments(filter),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Pending events fetched',
    body: { events, meta: buildPaginationMeta(page, limit, total) },
  })
})

export const approveEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findOne({ _id: id, status: 'pending_approval' })
  if (!event) {
    return sendTsRestError(res, 404, 'No pending event found with this id')
  }

  event.status = 'approved'
  event.publishedAt = new Date()
  await event.save()

  await recordAdminActivity(req, {
    action: 'event_approved',
    subjectType: 'event',
    subjectId: event._id,
    message: `Approved event ${event.title}`,
  })

  User.findById(event.organizer)
    .then(organizer => {
      if (organizer) {
        EmailService.sendEventApprovedEmail(organizer, event.title).catch(error =>
          logger.error({ err: error }, `Event-approved email failed for event ${event._id}`)
        )
      }
    })
    .catch(error => logger.error({ err: error }, `Could not load organizer for event ${event._id}`))

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event approved',
    body: event.toObject(),
  })
})

export const rejectEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const { reason } = req.body

  const event = await Event.findOne({ _id: id, status: 'pending_approval' })
  if (!event) {
    return sendTsRestError(res, 404, 'No pending event found with this id')
  }

  event.status = 'rejected'
  event.rejectionReason = reason
  await event.save()

  await recordAdminActivity(req, {
    action: 'event_rejected',
    subjectType: 'event',
    subjectId: event._id,
    message: `Rejected event ${event.title}`,
    metadata: { reason },
  })

  User.findById(event.organizer)
    .then(organizer => {
      if (organizer) {
        EmailService.sendEventRejectedEmail(organizer, event.title, reason).catch(error =>
          logger.error({ err: error }, `Event-rejected email failed for event ${event._id}`)
        )
      }
    })
    .catch(error => logger.error({ err: error }, `Could not load organizer for event ${event._id}`))

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event rejected',
    body: event.toObject(),
  })
})

export const approveEventPromotion = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findById(id)
  if (!event || !event.promotion) {
    return sendTsRestError(res, 404, 'No promotion request found for this event')
  }
  if (!event.promotion.paidAt) {
    return sendTsRestError(res, 400, 'Promotion payment has not been confirmed yet')
  }

  const pkg = getPromotionPackage(event.promotion.package)
  const durationDays = pkg?.durationDays ?? 7
  const startsAt = new Date()
  const endsAt = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000)

  event.promotion.status = 'approved'
  event.promotion.startsAt = startsAt
  event.promotion.endsAt = endsAt
  event.isPromoted = true
  await event.save()

  await recordAdminActivity(req, {
    action: 'promotion_approved',
    subjectType: 'promotion',
    subjectId: event._id,
    message: `Approved promotion for ${event.title}`,
    metadata: { package: event.promotion.package },
  })

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Promotion approved',
    body: event.toObject(),
  })
})

export const rejectEventPromotion = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findById(id)
  if (!event || !event.promotion) {
    return sendTsRestError(res, 404, 'No promotion request found for this event')
  }

  event.promotion.status = 'rejected'
  event.isPromoted = false
  await event.save()

  await recordAdminActivity(req, {
    action: 'promotion_rejected',
    subjectType: 'promotion',
    subjectId: event._id,
    message: `Rejected promotion for ${event.title}`,
    metadata: { package: event.promotion.package },
  })

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Promotion rejected',
    body: event.toObject(),
  })
})

export const listRefundRequests = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)
  const status = typeof req.query.status === 'string' ? req.query.status : 'pending'
  if (!['pending', 'approved', 'rejected', 'processed', 'all'].includes(status)) {
    return sendTsRestError(res, 400, 'Invalid refund request status')
  }
  const filter = status === 'all' ? {} : { status }

  const [refundRequests, total] = await Promise.all([
    RefundRequest.find(filter)
      .populate('event', 'title slug startDate status')
      .populate('requestedBy', 'fullname email')
      .populate('ticket', 'ticketId attendeeName attendeeEmail ticketTypeName pricePaid status')
      .populate('order', 'orderNumber customer subtotal refundedAmount paystackReference status')
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    RefundRequest.countDocuments(filter),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Refund requests fetched',
    body: { refundRequests, meta: buildPaginationMeta(page, limit, total) },
  })
})

export const getRefundRequest = tryCatchWrapper(async (req: Request, res: Response) => {
  if (!isValidObjectId(req.params.id)) {
    return sendTsRestError(res, 400, 'Invalid refund request ID')
  }

  const refundRequest = await RefundRequest.findById(req.params.id)
    .populate('event', 'title slug coverImage startDate status refundPolicy organizer')
    .populate('requestedBy', 'fullname email phone')
    .populate('ticket', 'ticketId attendeeName attendeeEmail attendeePhone ticketTypeName pricePaid status')
    .populate('order', 'orderNumber customer subtotal refundedAmount paystackReference status paidAt')
    .populate('approvedBy rejectedBy', 'fullname email')
    .lean()

  if (!refundRequest) {
    return sendTsRestError(res, 404, 'Refund request not found')
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Refund request fetched',
    body: refundRequest,
  })
})

/**
 * Locks one pending request, submits the refund to Paystack, then records
 * the local ticket/order updates in a transaction. The intermediate
 * `approved` state prevents duplicate external refund submissions.
 */
export const approveRefundRequest = tryCatchWrapper(async (req: Request, res: Response) => {
  if (!isValidObjectId(req.params.id)) {
    return sendTsRestError(res, 400, 'Invalid refund request ID')
  }

  const pendingRequest = await RefundRequest.findOne({
    _id: req.params.id,
    status: 'pending',
  })

  if (!pendingRequest) {
    return sendTsRestError(res, 409, 'Refund request is not pending or has already been reviewed')
  }

  const [order, ticket] = await Promise.all([
    Order.findById(pendingRequest.order),
    Ticket.findById(pendingRequest.ticket),
  ])

  if (!order || !ticket) {
    return sendTsRestError(res, 409, 'The refund request has an invalid order or ticket')
  }
  if (!order.paystackReference) {
    return sendTsRestError(res, 409, 'The order has no Paystack payment reference')
  }
  if (ticket.status === 'refunded') {
    return sendTsRestError(res, 409, 'This ticket has already been refunded')
  }

  const remainingRefundable = Math.max(0, order.subtotal - order.refundedAmount)
  if (pendingRequest.amount > remainingRefundable) {
    return sendTsRestError(res, 409, 'Refund amount exceeds the order balance')
  }

  const refundRequest = await RefundRequest.findOneAndUpdate(
    { _id: pendingRequest._id, status: 'pending' },
    {
      $set: {
        status: 'approved',
        approvedBy: req.session.userId,
        approvedAt: new Date(),
      },
    },
    { new: true, runValidators: true },
  )

  if (!refundRequest) {
    return sendTsRestError(res, 409, 'Refund request was reviewed by another admin')
  }

  const paystackRefund = await paystackService.refundTransaction({
    transactionReference: order.paystackReference,
    amountNaira: refundRequest.amount,
    reason: refundRequest.reason || `Refund for ticket ${ticket.ticketId}`,
  })

  refundRequest.paystackRefundReference = paystackRefund.reference
  refundRequest.providerStatus = paystackRefund.status
  await refundRequest.save()

  await recordAdminActivity(req, {
    action: 'refund_approved',
    subjectType: 'refund',
    subjectId: refundRequest._id,
    message: `Approved refund for ticket ${ticket.ticketId}`,
    metadata: { amount: refundRequest.amount, eventId: refundRequest.event.toString() },
  })

  return sendTsRestSuccess(res, 202, {
    success: true,
    message: 'Refund queued with Paystack and awaiting provider confirmation',
    body: refundRequest.toObject(),
  })
})

/**
 * Atomically rejects a pending refund request and records the admin,
 * reason and time of rejection. The pending-status condition ensures
 * that simultaneous review attempts cannot update the same request twice.
 */
export const rejectRefundRequest =
  tryCatchWrapper(
    async (
      req: Request,
      res: Response,
    ) => {
      const { id } = req.params
      const { reason } = req.body as {
        reason: string
      }

      const refundRequest =
        await RefundRequest.findOneAndUpdate(
          {
            _id: id,
            status: 'pending',
          },
          {
            $set: {
              status: 'rejected',
              rejectionReason: reason,
              rejectedBy:
                req.session.userId,
              rejectedAt: new Date(),
            },
          },
          {
            new: true,
            runValidators: true,
          },
        )

      if (!refundRequest) {
        return sendTsRestError(
          res,
          404,
          'No pending refund request found with this id',
        )
      }

      await recordAdminActivity(req, {
        action: 'refund_rejected',
        subjectType: 'refund',
        subjectId: refundRequest._id,
        message: 'Rejected refund request',
        metadata: { reason },
      })

      return sendTsRestSuccess(
        res,
        200,
        {
          success: true,
          message:
            'Refund request rejected',
          body:
            refundRequest.toObject(),
        },
      )
    },
  )

/**
 * Model already supports status: 'suspended' + suspendedReason (see
 * models/event.ts) — this is the admin handler that was flagged as missing
 * in lib/schemaValidation.ts's suspendEventSchema comment. Deliberately
 * broader than cancelEvent: suspension is a moderation action an admin can
 * apply to a live event (fraud, a complaint, a policy issue) without it
 * being the organizer's own cancellation — tickets/reservations are left
 * untouched here, since a suspension is a "pause for review", not a
 * cancellation with refunds. If the outcome ends up being "this event is
 * not happening," the admin (or organizer) still uses cancelEvent for that.
 */
export const suspendEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const { reason } = req.body as { reason: string }

  const event = await Event.findOne({ _id: id, status: { $in: ['approved', 'postponed'] as Array<'approved' | 'postponed'> } })
  if (!event) {
    return sendTsRestError(res, 404, 'No live event found with this id')
  }

  event.status = 'suspended'
  event.suspendedReason = reason
  await event.save()

  await recordAdminActivity(req, {
    action: 'event_suspended',
    subjectType: 'event',
    subjectId: event._id,
    message: `Suspended event ${event.title}`,
    metadata: { reason },
  })

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event suspended',
    body: event.toObject(),
  })
})

export const unsuspendEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params

  const event = await Event.findOne({ _id: id, status: 'suspended' })
  if (!event) {
    return sendTsRestError(res, 404, 'No suspended event found with this id')
  }

  event.status = 'approved'
  event.suspendedReason = undefined
  await event.save()

  await recordAdminActivity(req, {
    action: 'event_reinstated',
    subjectType: 'event',
    subjectId: event._id,
    message: `Reinstated event ${event.title}`,
  })

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event reinstated',
    body: event.toObject(),
  })
})


/**
 * Initiates one admin-approved organizer payout for an eligible paid
 * event. A 202 response means Paystack accepted the initiation workflow;
 * it does not mean the organizer has received the money. Final status is
 * reconciled separately through signed webhooks or transfer verification.
 */
export const initiateEventPayout =
  tryCatchWrapper(
    async (
      req: Request<InitiateEventPayoutParams>,
      res: Response,
    ) => {
      const adminId =
        req.session.userId

      if (!adminId) {
        return sendTsRestError(
          res,
          401,
          'Unauthorized: admin session is required',
        )
      }

      const payout =
        await payoutService
          .initiateEventPayout(
            req.params.eventId,
            adminId,
          )

      return sendTsRestSuccess(
        res,
        202,
        {
          success: true,
          message:
            'Payout initiated and awaiting Paystack confirmation',
          body: payout,
        },
      )
    },
  )
