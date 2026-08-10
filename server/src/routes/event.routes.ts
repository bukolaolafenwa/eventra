import { Router } from 'express'
import {
  cancelEvent,
  createEvent,
  deleteEvent,
  getEventBySlug,
  getEventDashboard,
  listMyEvents,
  listPublicEvents,
  postponeEvent,
  submitEventForApproval,
  updateEvent,
  updateEventLineup,
} from '../controllers/event.controller.js'
import { requireRole, verifySession } from '../middlewares/auth.middleware.js'
import { validateFormData } from '../middlewares/schema.middleware.js'
import {
  createEventSchema,
  postponeEventSchema,
  updateEventSchema,
} from '../lib/schemaValidation.js'

const router = Router()

/**
 * Public — no session required.
 * listPublicEvents only ever returns status: 'approved' events, and
 * getEventBySlug does the same, so these are safe to leave open.
 *
 * NOTE: '/slug/:slug' must be registered before '/:id' below, otherwise
 * Express will try to treat "slug" as an :id param.
 */
router.get('/', listPublicEvents)
router.get('/slug/:slug', getEventBySlug)

/**
 * Organizer-only — create, edit, and manage your own events.
 * The controller re-scopes every query to organizer: req.session.userId,
 * so requireRole here is just the first gate; ownership is enforced again
 * at the DB level in every handler.
 */
router.post('/', verifySession, requireRole('organizer'), validateFormData(createEventSchema), createEvent)
router.get('/my', verifySession, requireRole('organizer'), listMyEvents)
router.get('/:id/dashboard', verifySession, requireRole('organizer'), getEventDashboard)

router.patch('/:id', verifySession, requireRole('organizer'), validateFormData(updateEventSchema), updateEvent)
router.patch('/:id/lineup', verifySession, requireRole('organizer'), updateEventLineup)

router.post('/:id/submit', verifySession, requireRole('organizer'), submitEventForApproval)
router.delete('/:id', verifySession, requireRole('organizer'), deleteEvent)

/**
 * Organizer or admin — cancelEvent and postponeEvent both branch internally
 * on req.session.role === 'admin' to decide whether to scope the lookup to
 * the organizer's own events or allow any event, so both roles need to reach
 * the controller.
 */
router.post('/:id/cancel', verifySession, requireRole('organizer', 'admin'), cancelEvent)
router.post(
  '/:id/postpone',
  verifySession,
  requireRole('organizer', 'admin'),
  validateFormData(postponeEventSchema),
  postponeEvent
)

export default router





















// import { Router } from 'express'

// import { createEvent } from '../controllers/event.controller.js'

// import {
//   verifySession,
//   requireRole,
// } from '../middlewares/auth.middleware.js'

// import { validateFormData } from '../middlewares/schema.middleware.js'
// import { customRateLimiter } from '../middlewares/rateLimit.middleware.js'
// import { clearCache } from '../middlewares/cache.middleware.js'

// import { createEventSchema } from '../lib/schemaValidation.js'

// const router = Router()

// /**
//  * @route   POST /api/v1/events
//  * @desc    Create a new event
//  * @access  Organizer
//  */
// router.post(
//   '/',
//   customRateLimiter(5),
//   verifySession,
//   requireRole('organizer'),
//   validateFormData(createEventSchema),
//   clearCache('events'),
//   createEvent
// )

// export default router