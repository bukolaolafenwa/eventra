import { Router } from 'express'

import { createEvent } from '../controllers/event.controller.js'

import {
  verifySession,
  requireRole,
} from '../middlewares/auth.middleware.js'

import { validateFormData } from '../middlewares/schema.middleware.js'
import { customRateLimiter } from '../middlewares/rateLimit.middleware.js'
import { clearCache } from '../middlewares/cache.middleware.js'

import { createEventSchema } from '../lib/schemaValidation.js'

const router = Router()

/**
 * @route   POST /api/v1/events
 * @desc    Create a new event
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

export default router