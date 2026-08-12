import crypto from 'crypto'
import { Request, Response } from 'express'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import {
  buildPaginationMeta,
  escapeRegExp,
  getDateRangeForWhen,
  getPagination,
  isValidObjectId,
  slugify,
} from '../lib/utils.js'
import Category from '../models/category.js'
import Event from '../models/event.js'
import Order from '../models/order.js'
import Ticket from '../models/ticket.js'
import TicketType from '../models/tickettype.js'
import User from '../models/user.js'
import { paystackService } from '../services/paystack.service.js'

const EDITABLE_STATUSES = ['draft', 'rejected']

export const createEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { category: categoryId, ...rest } = req.body

  const category = await Category.findOne({ _id: categoryId, isActive: true })
  if (!category) {
    return sendTsRestError(res, 400, 'Invalid or inactive category')
  }

  const slug = `${slugify(rest.title)}-${crypto.randomBytes(3).toString('hex')}`

  const event = await Event.create({
    ...rest,
    category: category._id,
    slug,
    organizer: req.session.userId,
    status: 'draft',
  })

  return sendTsRestSuccess(res, 201, {
    success: true,
    message: 'Event created as a draft',
    body: event.toObject(),
  })
})

export const updateEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findOne({ _id: id, organizer: req.session.userId })

  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }
  if (!EDITABLE_STATUSES.includes(event.status)) {
    return sendTsRestError(res, 400, 'Only draft or rejected events can be edited')
  }

  const { category: categoryId, ...rest } = req.body

  if (categoryId) {
    const category = await Category.findOne({ _id: categoryId, isActive: true })
    if (!category) {
      return sendTsRestError(res, 400, 'Invalid or inactive category')
    }
    event.category = category._id
  }

  Object.assign(event, rest)
  await event.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event updated',
    body: event.toObject(),
  })
})

/**
 * Separate from updateEvent on purpose — that endpoint is locked to
 * draft/rejected events because changing venue, date, price, or capacity
 * on a live event is exactly the kind of thing that should require
 * re-approval. Lineup isn't that: "DJ X just confirmed" is routine on an
 * event that's already approved and selling tickets, so this only blocks
 * cancelled events, not approved/pending/postponed ones.
 */
export const updateEventLineup = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findOne({ _id: id, organizer: req.session.userId })

  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }
  if (event.status === 'cancelled') {
    return sendTsRestError(res, 400, "Can't edit the lineup of a cancelled event")
  }

  event.lineup = req.body.lineup
  await event.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Lineup updated',
    body: event.toObject(),
  })
})

export const submitEventForApproval = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findOne({ _id: id, organizer: req.session.userId })

  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }
  if (!EDITABLE_STATUSES.includes(event.status)) {
    return sendTsRestError(res, 400, 'This event has already been submitted')
  }

  const organizer = await User.findById(req.session.userId)
  if (!organizer || !organizer.organizerProfile) {
    return sendTsRestError(res, 400, 'Complete your organizer profile before submitting an event')
  }
  if (organizer.organizerProfile.approvalStatus !== 'approved') {
    return sendTsRestError(res, 400, 'Your organizer profile must be approved before submitting an event')
  }
  // PRD Section 6 / organizer.controller.ts's upsertOrganizerProfile comment:
  // bank details are only required for paid events to go live, not free ones.
  if (event.type === 'paid' && !organizer.organizerProfile.isPayoutReady) {
    return sendTsRestError(res, 400, 'Add your bank account details before submitting a paid event')
  }
  // A paid event needs something to actually sell before it can go live —
  // mirrors createTicketType in ticketType.controller.ts, the only place
  // TicketType docs for this event get created.
  if (event.type === 'paid') {
    const ticketTypeCount = await TicketType.countDocuments({ event: event._id })
    if (ticketTypeCount === 0) {
      return sendTsRestError(res, 400, 'Add at least one ticket type before submitting a paid event')
    }
  }

  // A draft can sit around indefinitely, or a rejected one gets resubmitted
  // without its date being touched — either way, don't let a startDate that's
  // already passed enter the approval queue.
  if (event.startDate < new Date()) {
    return sendTsRestError(res, 400, 'This event\'s start date has already passed — update it before submitting')
  }

  event.status = 'pending_approval'
  event.rejectionReason = undefined
  await event.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event submitted for admin approval',
    body: event.toObject(),
  })
})

// Lets an organizer pull an event back out of the admin's queue before it's
// been reviewed — e.g. they found a venue conflict or changed their mind.
// Deliberately organizer-only (no admin bypass): once an admin has actually
// approved/rejected it, this is no longer the right lever — cancelEvent
// covers withdrawing a live approved event instead.
export const withdrawEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findOne({ _id: id, organizer: req.session.userId })

  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }
  if (event.status !== 'pending_approval') {
    return sendTsRestError(res, 400, 'Only an event awaiting approval can be withdrawn')
  }

  event.status = 'draft'
  await event.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event withdrawn — back to draft',
    body: event.toObject(),
  })
})

export const deleteEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findOne({ _id: id, organizer: req.session.userId })

  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }
  if (!EDITABLE_STATUSES.includes(event.status) || event.reservationsCount > 0 || event.ticketsSoldCount > 0) {
    return sendTsRestError(res, 400, 'Only draft or rejected events with no reservations/sales can be deleted')
  }

  await TicketType.deleteMany({ event: event._id })
  await event.deleteOne()

  return sendTsRestSuccess<undefined>(res, 200, {
    success: true,
    message: 'Event deleted',
  })
})

export const listMyEvents = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)
  const filter = { organizer: req.session.userId }

  const [events, total] = await Promise.all([
    Event.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Event.countDocuments(filter),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Your events fetched',
    body: { events, meta: buildPaginationMeta(page, limit, total) },
  })
})

// Public — only ever surfaces admin-approved/postponed events.
export const listPublicEvents = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)

  const filter: Record<string, any> = { status: { $in: ['approved', 'postponed'] } }

  // Category — accepts a single id or a comma-separated list, e.g. ?category=a,b,c
  if (req.query.category && typeof req.query.category === 'string') {
    const categoryIds = req.query.category.split(',').map(id => id.trim()).filter(isValidObjectId)
    if (categoryIds.length === 1) filter.category = categoryIds[0]
    else if (categoryIds.length > 1) filter.category = { $in: categoryIds }
  }

  if (req.query.city && typeof req.query.city === 'string') {
    filter['venue.city'] = new RegExp(escapeRegExp(req.query.city), 'i')
  }
  if (req.query.type === 'free' || req.query.type === 'paid') filter.type = req.query.type

  // Date — today / this-weekend / this-week / this-month
  if (typeof req.query.when === 'string') {
    const range = getDateRangeForWhen(req.query.when)
    if (range) {
      filter.startDate = { $gte: range.from, $lt: range.to }
    }
  }

  // Price — filters on the denormalized Event.minPrice (see models/event.ts)
  const minPrice = Number(req.query.minPrice)
  const maxPrice = Number(req.query.maxPrice)
  if (!Number.isNaN(minPrice) || !Number.isNaN(maxPrice)) {
    filter.minPrice = {}
    if (!Number.isNaN(minPrice)) filter.minPrice.$gte = minPrice
    if (!Number.isNaN(maxPrice)) filter.minPrice.$lte = maxPrice
  }

  const searchQuery = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : null
  if (searchQuery) {
    filter.$text = { $search: searchQuery }
  }

  const projection = searchQuery ? { score: { $meta: 'textScore' } } : undefined

  // A search term always takes priority for ordering. Otherwise, `sort` picks
  // the order; default ("trending") is featured-first then soonest.
  let sort: Record<string, any> = { isPromoted: -1, startDate: 1 }
  if (searchQuery) {
    sort = { score: { $meta: 'textScore' } }
  } else if (req.query.sort === 'date') {
    sort = { startDate: 1 }
  } else if (req.query.sort === 'price-asc') {
    sort = { minPrice: 1 }
  } else if (req.query.sort === 'price-desc') {
    sort = { minPrice: -1 }
  }

  const [events, total] = await Promise.all([
    Event.find(filter, projection)
      .sort(sort as any)
      .skip(skip)
      .limit(limit)
      .populate('category', 'name slug')
      .lean(),
    Event.countDocuments(filter),
  ])

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Events fetched',
    body: { events, meta: buildPaginationMeta(page, limit, total) },
  })
})

export const getEventDashboard = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findOne({ _id: id, organizer: req.session.userId }).lean()
  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }

  const [ticketTypes, checkedInCount, recentAttendees] = await Promise.all([
    event.type === 'paid'
      ? TicketType.find({ event: event._id })
          .select('name price quantity quantitySold quantityReserved purchaseLimitPerPerson isActive')
          .lean()
      : Promise.resolve([]),
    Ticket.countDocuments({ event: event._id, status: 'used' }),
    Ticket.find({ event: event._id })
      .select('attendeeName code status ticketTypeName')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
  ])

  const body = {
    event: {
      _id: event._id,
      title: event.title,
      status: event.status,
      type: event.type,
      startDate: event.startDate,
      lineup: event.lineup,
    },
    reservationsCount: event.reservationsCount,
    capacity: event.capacity ?? null,
    capacityRemaining: event.capacity ? Math.max(event.capacity - event.reservationsCount, 0) : null,
    ticketsSoldCount: event.ticketsSoldCount,
    revenueTotal: event.revenueTotal,
    checkedInCount,
    recentAttendees: recentAttendees.map(t => ({
      _id: t._id,
      attendeeName: t.attendeeName,
      code: t.code,
      status: t.status,
      ticketTypeName: t.ticketTypeName,
    })),
    ticketTypes: ticketTypes.map(tt => ({
      ...tt,
      quantityRemaining: Math.max(tt.quantity - tt.quantitySold - tt.quantityReserved, 0),
    })),
    payout: {
      // PRD Section 8: Eventra retains 5% commission, organizer gets the
      // remainder. revenueTotal is gross ticket sales — this is what's
      // actually owed to the organizer, held until a few days after the
      // event (see PAYOUT_DELAY_DAYS in ticket.service.ts).
      amountDue: Math.round(event.revenueTotal * 0.95),
    },
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Dashboard fetched',
    body,
  })
})

/**
 * Cancels a live event. Paid orders are refunded in full for whatever
 * hasn't already been refunded (a ticket-level refund request may have
 * partially refunded an order before the event itself was cancelled), and
 * every ticket on the event is invalidated — paid tickets marked
 * 'refunded', free reservations marked 'cancelled' since there's no
 * payment behind them to refund.
 */
export const cancelEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const isAdmin = req.session.role === 'admin'

  const event = await Event.findOne(isAdmin ? { _id: id } : { _id: id, organizer: req.session.userId })
  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }
  if (event.status !== 'approved' && event.status !== 'postponed') {
    return sendTsRestError(res, 400, 'Only a live (approved or postponed) event can be cancelled')
  }

  event.status = 'cancelled'
  event.cancelledAt = new Date()
  await event.save()

  if (event.type === 'paid') {
    const paidOrders = await Order.find({ event: event._id, status: { $in: ['paid', 'partially_refunded'] as Array<'paid' | 'partially_refunded'> } })

    for (const order of paidOrders) {
      const remainingAmount = order.totalAmount - order.refundedAmount
      try {
        if (remainingAmount > 0 && order.paystackReference) {
          await paystackService.refundTransaction({
            transactionReference: order.paystackReference,
            amountNaira: remainingAmount,
            reason: 'Event cancelled by organizer',
          })
        }
        order.refundedAmount = order.totalAmount
        order.status = 'refunded'
        await order.save()
        await Ticket.updateMany({ order: order._id, status: { $in: ['active', 'used'] as Array<'active' | 'used'> } }, { status: 'refunded' })
      } catch (error: any) {
        // Logged inside paystackService — leave this order for manual admin
        // follow-up rather than failing the whole cancellation over one bad refund.
      }
    }
  } else {
    await Ticket.updateMany({ event: event._id, status: 'active' }, { status: 'cancelled' })
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: event.type === 'paid' ? 'Event cancelled. Paid attendees are being refunded' : 'Event cancelled',
    body: event.toObject(),
  })
})

/**
 * Postpones a live event to a new date. Existing tickets stay valid; attendees
 * who can't make the new date use the normal refund-request flow.
 */
export const postponeEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const { newStartDate } = req.body
  const isAdmin = req.session.role === 'admin'

  const event = await Event.findOne(isAdmin ? { _id: id } : { _id: id, organizer: req.session.userId })
  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }
  // Allows postponing again even if the event is already postponed — status
  // never moves back to 'approved' automatically once the new date arrives,
  // so restricting this to only 'approved' would permanently lock an event
  // out of ever being postponed a second time. The newStartDate-after-current
  // check below already guarantees forward progress regardless.
  if (event.status !== 'approved' && event.status !== 'postponed') {
    return sendTsRestError(res, 400, 'Only a live approved or postponed event can be postponed')
  }
  // Zod (postponeEventSchema) already confirms newStartDate isn't in the past —
  // this additionally confirms it's actually later than the event's current
  // date, which needs the document and can't be checked in the schema alone.
  if (new Date(newStartDate) <= event.startDate) {
    return sendTsRestError(res, 400, 'New date must be after the event\'s current start date')
  }

  // startDate is the single source of truth Explore/search sort and filter
  // by (see listPublicEvents) — updating it here is what actually moves a
  // postponed event to its correct place in date-based results. postponedTo
  // is kept too, purely as a record of "this event was postponed."
  //
  // For multi-day events (endDate set), shift endDate by the same gap so
  // the event keeps its original length — otherwise startDate could end up
  // later than the existing endDate, and nothing at the DB layer guards
  // against that (the endDate>=startDate check only lives in Zod, which
  // postponeEventSchema doesn't include).
  if (event.endDate) {
    const durationMs = event.endDate.getTime() - event.startDate.getTime()
    event.endDate = new Date(new Date(newStartDate).getTime() + durationMs)
  }
  event.status = 'postponed'
  event.startDate = new Date(newStartDate)
  event.postponedTo = new Date(newStartDate)
  await event.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event postponed. Existing tickets remain valid',
    body: event.toObject(),
  })
})

export const getEventBySlug = tryCatchWrapper(async (req: Request, res: Response) => {
  const { slug } = req.params

  const event = await Event.findOne({ slug, status: { $in: ['approved', 'postponed'] as Array<'approved' | 'postponed'> } })
    .populate('category', 'name slug')
    .populate('organizer', 'fullname organizerProfile.businessName')
    .lean()

  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }

  const ticketTypes =
    event.type === 'paid' ? await TicketType.find({ event: event._id, isActive: true }).lean() : []

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event fetched',
    body: { ...event, ticketTypes },
  })
})