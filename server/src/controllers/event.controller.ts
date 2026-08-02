import crypto from 'crypto'
import { Request, Response } from 'express'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import {
  buildPaginationMeta,
  escapeRegExp,
  getPagination,
  isValidObjectId,
  slugify,
} from '../lib/utils.js'
import Category from '../models/category.js'
import Event from '../models/event.js'

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

// TODO: restore the organizer-approval check (needs the User model) and the
// paid-event bank-details / ticket-type checks (needs the TicketType model)
// once those imports are available.
export const submitEventForApproval = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findOne({ _id: id, organizer: req.session.userId })

  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }
  if (!EDITABLE_STATUSES.includes(event.status)) {
    return sendTsRestError(res, 400, 'This event has already been submitted')
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

// TODO: re-add `await TicketType.deleteMany({ event: event._id })` once
// TicketType is imported, so orphaned ticket types don't get left behind.
export const deleteEvent = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findOne({ _id: id, organizer: req.session.userId })

  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }
  if (!EDITABLE_STATUSES.includes(event.status) || event.reservationsCount > 0 || event.ticketsSoldCount > 0) {
    return sendTsRestError(res, 400, 'Only draft or rejected events with no reservations/sales can be deleted')
  }

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

// Public — only ever surfaces admin-approved events.
// TODO: restore the "when" (today / this-weekend / this-week / this-month)
// filter once a getDateRangeForWhen helper is imported.
export const listPublicEvents = tryCatchWrapper(async (req: Request, res: Response) => {
  const { page, limit, skip } = getPagination(req.query)

  const filter: Record<string, any> = { status: 'approved' }

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

// TODO: restore the TicketType breakdown (name/price/quantity/quantitySold/
// purchaseLimitPerPerson/isActive + quantityRemaining) once TicketType is imported.
export const getEventDashboard = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const event = await Event.findOne({ _id: id, organizer: req.session.userId }).lean()
  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }

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
    payout: {
      // Funds are held until a few days after the event — see PAYOUT_DELAY_DAYS in ticket.service.ts
      amountDue: event.revenueTotal,
    },
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Dashboard fetched',
    body,
  })
})

/**
 * Cancels a live event.
 * TODO: restore the paid-event refund flow (Order, PaystackService, Ticket)
 * once those are imported — one Paystack refund per paid order, then mark
 * orders 'refunded' and invalidate their tickets. Free reservations should
 * still get their tickets invalidated too.
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

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event cancelled',
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

  if (!newStartDate) {
    return sendTsRestError(res, 400, 'newStartDate is required')
  }

  const event = await Event.findOne(isAdmin ? { _id: id } : { _id: id, organizer: req.session.userId })
  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }
  if (event.status !== 'approved') {
    return sendTsRestError(res, 400, 'Only a live approved event can be postponed')
  }

  event.status = 'postponed'
  event.postponedTo = new Date(newStartDate)
  await event.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event postponed. Existing tickets remain valid',
    body: event.toObject(),
  })
})

// TODO: restore the `ticketTypes` array (needs TicketType) once it's imported.
export const getEventBySlug = tryCatchWrapper(async (req: Request, res: Response) => {
  const { slug } = req.params

  const event = await Event.findOne({ slug, status: 'approved' })
    .populate('category', 'name slug')
    .populate('organizer', 'fullname organizerProfile.businessName')
    .lean()

  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Event fetched',
    body: event,
  })
})