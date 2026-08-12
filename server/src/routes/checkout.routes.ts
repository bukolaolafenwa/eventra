import { Router } from 'express'

import { createCheckout } from '../controllers/checkout.controller.js'
import { checkoutSchema } from '../lib/schemaValidation.js'
import { clearCache } from '../middlewares/cache.middleware.js'
import { customRateLimiter } from '../middlewares/rateLimit.middleware.js'
import { validateFormData } from '../middlewares/schema.middleware.js'

const router = Router()

/**
 * @route   POST /api/v1/events/:eventId/checkout
 * @desc    Reserve paid tickets and initialize Paystack checkout
 * @access  Public — supports authenticated attendees and guests
 */
router.post(
  '/:eventId/checkout',
  customRateLimiter(10),
  validateFormData(checkoutSchema),
  clearCache('events'),
  createCheckout,
)

export default router