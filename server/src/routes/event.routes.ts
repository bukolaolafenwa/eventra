import { Router } from 'express'

import {
  createEvent,
  updateEvent,
  updateEventLineup,
  submitEventForApproval,
  withdrawEvent,
  deleteEvent,
  duplicateEvent,
  listMyEvents,
  getMyEventById,
  listPublicEvents,
  getSpotlightEvents,
  getEventDashboard,
  cancelEvent,
  postponeEvent,
  getEventBySlug,
} from '../controllers/event.controller.js'


import { requestPromotion } from '../controllers/promotion.controller.js'

import {
  verifySession,
  requireRole,
} from '../middlewares/auth.middleware.js'

import { validateFormData } from '../middlewares/schema.middleware.js'
import { customRateLimiter } from '../middlewares/rateLimit.middleware.js'
import { cacheMiddleware, clearCache } from '../middlewares/cache.middleware.js'

import {
  createEventSchema,
  updateEventSchema,
  updateEventLineupSchema,
  postponeEventSchema,
  checkInSchema,
  requestPromotionSchema,
} from '../lib/schemaValidation.js'

const router = Router()

/**
 * @route   POST /api/v1/events
 * @desc    Create a new event (starts as draft)
 * @access  Organizer
 */
router.post(
  '/',
  customRateLimiter(5),
  verifySession,
  requireRole('organizer'),
  validateFormData(createEventSchema),
  clearCache('events'),
  createEvent
)

/**
 * @route   GET /api/v1/events
 * @desc    Browse/search published events (Explore page)
 * @access  Public
 */
router.get('/', cacheMiddleware(60), listPublicEvents)

/**
 * @route   GET /api/v1/events/spotlight
 * @desc    Currently-promoted approved events for the homepage/explore
 *          spotlight strip
 * @access  Public
 * NOTE: registered before GET /:slug for the same reason /my-events is —
 * a literal path segment must never be swallowed by the generic :slug route.
 */
router.get('/spotlight', cacheMiddleware(60), getSpotlightEvents)

/**
 * @route   GET /api/v1/events/my-events
 * @desc    List the current organizer's own events
 * @access  Organizer
 * NOTE: must be registered before GET /:slug — both are single-segment
 * paths, and Express matches by registration order, not specificity.
 * Swapping this below /:slug would route "my-events" requests into
 * getEventBySlug instead.
 */
router.get('/my-events', verifySession, requireRole('organizer'), listMyEvents)

// Alias for sever-a's reference client, which calls /mine instead of
// /my-events for the same thing — kept as a second route to the same
// handler rather than renaming /my-events, so neither existing consumer
// breaks.
router.get('/mine', verifySession, requireRole('organizer'), listMyEvents)

/**
 * @route   GET /api/v1/events/my-events/:id
 * @desc    Fetch the raw event document for the create/edit wizard to resume a draft
 * @access  Organizer (owner only — enforced in controller)
 */
router.get('/my-events/:id', verifySession, requireRole('organizer'), getMyEventById)

// Alias matching sever-a's /mine/:id path — same reasoning as /mine above.
router.get('/mine/:id', verifySession, requireRole('organizer'), getMyEventById)

/**
 * @route   PATCH /api/v1/events/:id
 * @desc    Edit a draft or rejected event
 * @access  Organizer (owner only — enforced in controller)
 */
router.patch(
  '/:id',
  customRateLimiter(10),
  verifySession,
  requireRole('organizer'),
  validateFormData(updateEventSchema),
  clearCache('events'),
  updateEvent
)

/**
 * @route   PATCH /api/v1/events/:id/lineup
 * @desc    Replace an event's lineup (allowed on any status except cancelled)
 * @access  Organizer (owner only — enforced in controller)
 */
router.patch(
  '/:id/lineup',
  customRateLimiter(10),
  verifySession,
  requireRole('organizer'),
  validateFormData(updateEventLineupSchema),
  clearCache('events'),
  updateEventLineup
)

/**
 * @route   PATCH /api/v1/events/:id/submit
 * @desc    Submit a draft/rejected event for admin approval
 * @access  Organizer (owner only — enforced in controller)
 */
router.post(
  '/:id/submit',
  customRateLimiter(5),
  verifySession,
  requireRole('organizer'),
  clearCache('events'),
  submitEventForApproval
)

/**
 * @route   PATCH /api/v1/events/:id/withdraw
 * @desc    Pull a pending-approval event back to draft before admin review
 * @access  Organizer (owner only — enforced in controller)
 */
router.patch(
  '/:id/withdraw',
  customRateLimiter(5),
  verifySession,
  requireRole('organizer'),
  clearCache('events'),
  withdrawEvent
)

/**
 * @route   PATCH /api/v1/events/:id/cancel
 * @desc    Cancel a live (approved or postponed) event
 * @access  Organizer (owner) or Admin — controller branches on role,
 *          so this intentionally does NOT use requireRole('organizer'):
 *          that would lock admins out entirely.
 */
router.patch(
  '/:id/cancel',
  customRateLimiter(5),
  verifySession,
  clearCache('events'),
  cancelEvent
)

/**
 * @route   PATCH /api/v1/events/:id/postpone
 * @desc    Postpone a live approved event to a new date
 * @access  Organizer (owner) or Admin — same dual-role reasoning as cancel.
 */
router.patch(
  '/:id/postpone',
  customRateLimiter(5),
  verifySession,
  validateFormData(postponeEventSchema),
  clearCache('events'),
  postponeEvent
)

/**
 * @route   DELETE /api/v1/events/:id
 * @desc    Delete a draft or rejected event with no reservations/sales
 * @access  Organizer (owner only — enforced in controller)
 */
router.delete(
  '/:id',
  customRateLimiter(5),
  verifySession,
  requireRole('organizer'),
  clearCache('events'),
  deleteEvent
)

/**
 * @route   GET /api/v1/events/:id/dashboard
 * @desc    Organizer's live stats for one event (sales, reservations, payout)
 * @access  Organizer (owner only — enforced in controller)
 */
router.get('/:id/dashboard', verifySession, requireRole('organizer'), getEventDashboard)

/**
 * @route   POST /api/v1/events/:id/duplicate
 * @desc    Clone an event (and its ticket types) into a fresh draft
 * @access  Organizer (owner only — enforced in controller)
 */
router.post(
  '/:id/duplicate',
  customRateLimiter(5),
  verifySession,
  requireRole('organizer'),
  clearCache('events'),
  duplicateEvent
)

/**
 * @route   POST /api/v1/events/:id/promote
 * @desc    Request a paid promotion package for an event
 * @access  Organizer (owner only — enforced in controller)
 */
router.post(
  '/:id/promote',
  verifySession,
  requireRole('organizer'),
  validateFormData(requestPromotionSchema),
  requestPromotion
)

/**
 * @route   GET /api/v1/events/:slug
 * @desc    Public event detail page
 * @access  Public
 * NOTE: must be the LAST GET route registered — it's the most generic
 * single-segment pattern and would otherwise shadow /my-events.
 */
router.get('/:slug', cacheMiddleware(60), getEventBySlug)

export default router