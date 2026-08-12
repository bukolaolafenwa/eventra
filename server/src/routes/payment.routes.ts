import { Router } from 'express'

import {
  handlePaystackWebhook,
  verifyPaystackPayment,
} from '../controllers/payment.controller.js'
import { clearCache } from '../middlewares/cache.middleware.js'
import { customRateLimiter } from '../middlewares/rateLimit.middleware.js'

const router = Router()

/**
 * @route   GET /api/v1/payments/paystack/verify/:reference
 * @desc    Verify a Paystack transaction and complete its order
 * @access  Public — Paystack reference is verified server-to-server
 */
router.get(
  '/paystack/verify/:reference',
  customRateLimiter(10),
  clearCache('events'),
  verifyPaystackPayment,
)

/**
 * @route   POST /api/v1/payments/paystack/webhook
 * @desc    Receive and verify Paystack webhook events
 * @access  Public — protected by Paystack signature verification
 */
router.post(
  '/paystack/webhook',
  clearCache('events'),
  handlePaystackWebhook,
)

export default router