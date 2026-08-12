import { Router } from 'express'

import {
  getOrganizerOverview,
  getOrganizerProfile,
  listBanks,
  listOrganizerPayouts,
  resolveBankAccount,
  submitOrganizerProfileForReview,
  upsertOrganizerProfile,
} from '../controllers/organizer.controller.js'

import { verifySession } from '../middlewares/auth.middleware.js'
import { customRateLimiter } from '../middlewares/rateLimit.middleware.js'
import { validateFormData } from '../middlewares/schema.middleware.js'
import { organizerProfileSchema, resolveBankAccountSchema } from '../lib/schemaValidation.js'

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
  validateFormData(organizerProfileSchema),
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

/**
 * @route   GET /api/v1/organizers/banks
 * @desc    Nigerian bank list for the "Select bank" dropdown (Paystack, in-process cached)
 * @access  Authenticated user
 */
router.get('/banks', listBanks)

/**
 * @route   POST /api/v1/organizers/resolve-account
 * @desc    Confirm the account holder's name for a bank account before saving it
 * @access  Authenticated user
 */
router.post(
  '/resolve-account',
  customRateLimiter(10),
  validateFormData(resolveBankAccountSchema),
  resolveBankAccount
)

/**
 * @route   GET /api/v1/organizers/overview
 * @desc    Dashboard Overview stats — tickets sold, revenue, live events, payout due
 * @access  Organizer
 */
router.get('/overview', getOrganizerOverview)

/**
 * @route   GET /api/v1/organizers/payouts
 * @desc    Earnings-by-event and payout history for the Payouts page
 * @access  Organizer
 */
router.get('/payouts', listOrganizerPayouts)

export default router