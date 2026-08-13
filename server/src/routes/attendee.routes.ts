import { Router } from 'express'

import { listEventAttendees } from '../controllers/attendee.controller.js'
import {
  requireRole,
  verifySession,
} from '../middlewares/auth.middleware.js'

const router = Router()

/**
 * @route   GET /api/v1/events/:eventId/attendees
 * @desc    List attendees for an organizer-owned event
 * @access  Organizer (event owner only)
 */
router.get(
  '/:eventId/attendees',
  verifySession,
  requireRole('organizer'),
  listEventAttendees,
)

export default router