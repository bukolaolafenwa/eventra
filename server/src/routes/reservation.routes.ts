import { Router } from 'express'

import { createReservation } from '../controllers/reservation.controller.js'
import { createReservationSchema } from '../lib/schemaValidation.js'
import { clearCache } from '../middlewares/cache.middleware.js'
import { customRateLimiter } from '../middlewares/rateLimit.middleware.js'
import { validateFormData } from '../middlewares/schema.middleware.js'

const router = Router()

/**
 * @route   POST /api/v1/events/:eventId/reservations
 * @desc    Reserve free-event spaces and issue QR tickets
 * @access  Public — supports authenticated attendees and guests
 */
router.post(
  '/:eventId/reservations',
  customRateLimiter(5),
  validateFormData(createReservationSchema),
  clearCache('events'),
  createReservation,
)

export default router