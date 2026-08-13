import { Router } from 'express'

import {
  createEvent,
  updateEvent,
  updateEventLineup,
  submitEventForApproval,
  withdrawEvent,
  deleteEvent,
  listMyEvents,
  listPublicEvents,
  getEventDashboard,
  cancelEvent,
  postponeEvent,
  getEventBySlug,
} from '../controllers/event.controller.js'

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
 * @route   GET /api/v1/events/my-events
 * @desc    List the current organizer's own events
 * @access  Organizer
 * NOTE: must be registered before GET /:slug — both are single-segment
 * paths, and Express matches by registration order, not specificity.
 * Swapping this below /:slug would route "my-events" requests into
 * getEventBySlug instead.
 */
router.get('/my-events', verifySession, requireRole('organizer'), listMyEvents)

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
router.patch(
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
 * @route   GET /api/v1/events/:slug
 * @desc    Public event detail page
 * @access  Public
 * NOTE: must be the LAST GET route registered — it's the most generic
 * single-segment pattern and would otherwise shadow /my-events.
 */
router.get('/:slug', cacheMiddleware(60), getEventBySlug)

export default router