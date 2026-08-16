import { Router } from 'express'

import { checkInTicket } from '../controllers/checkin.controller.js'
import {
  verifySession,
  requireRole,
} from '../middlewares/auth.middleware.js'
import { customRateLimiter } from '../middlewares/rateLimit.middleware.js'
import { validateFormData } from '../middlewares/schema.middleware.js'
import { checkInSchema } from '../lib/schemaValidation.js'

const router = Router()

/**
 * @route   POST /api/v1/events/:eventId/check-in
 * @desc    Check an attendee into an event using a ticket code
 * @access  Organizer (event owner only)
 */
router.post(
  '/:eventId/check-in',
  customRateLimiter(10),
  verifySession,
  requireRole('organizer'),
  validateFormData(checkInSchema),
  checkInTicket,
)

export default router