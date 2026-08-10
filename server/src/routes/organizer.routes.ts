import { Router } from 'express'

import {
  getOrganizerProfile,
  submitOrganizerProfileForReview,
  upsertOrganizerProfile,
} from '../controllers/organizer.controller.js'

import { verifySession } from '../middlewares/auth.middleware.js'
import { customRateLimiter } from '../middlewares/rateLimit.middleware.js'

const router = Router()

// Every organizer-profile endpoint requires an authenticated session.
router.use(verifySession)

/**
 * @route   GET /api/v1/organizers/profile
 * @desc    Get the authenticated user's organizer profile
 * @access  Authenticated user
 */
router.get('/profile', getOrganizerProfile)

/**
 * @route   PATCH /api/v1/organizers/profile
 * @desc    Create or partially update an organizer profile
 * @access  Authenticated user
 */
router.patch(
  '/profile',
  customRateLimiter(10),
  upsertOrganizerProfile
)

/**
 * @route   POST /api/v1/organizers/profile/submit
 * @desc    Submit a completed organizer profile for admin review
 * @access  Authenticated user
 */
router.post(
  '/profile/submit',
  customRateLimiter(5),
  submitOrganizerProfileForReview
)

export default router