import { Router } from 'express'
import {
  approveEvent,
  approveEventPromotion,
  approveOrganizer,
  approveRefundRequest,
  getAdminOverview,
  getApprovalQueue,
  getEventReview,
  getOrganizerReview,
  getPlatformStats,
  getRefundRequest,
  initiateEventPayout,
  listPendingEvents,
  listPendingOrganizers,
  listPendingPromotions,
  listAdminActivities,
  listRefundRequests,
  listTopOrganizers,
  listUsers,
  rejectEvent,
  rejectEventPromotion,
  rejectOrganizer,
  rejectRefundRequest,
  suspendEvent,
  suspendUser,
  unsuspendEvent,
  unsuspendUser,
} from '../controllers/admin.controller.js'
import { requireAdmin, verifySession } from '../middlewares/auth.middleware.js'
import { validateFormData } from '../middlewares/schema.middleware.js'
import {
  approveRefundRequestSchema,
  createCategorySchema,
  initiatePayoutSchema,
  rejectEventSchema,
  rejectRefundRequestSchema,
  suspendEventSchema,
  updateCategorySchema,
} from '../lib/schemaValidation.js'
import { customRateLimiter } from '../middlewares/rateLimit.middleware.js'

const router = Router()

router.use(verifySession, requireAdmin)

// Platform stats
router.get('/stats', getPlatformStats)
router.get('/overview', getAdminOverview)
router.get('/activities', listAdminActivities)
router.get('/organizers/top', listTopOrganizers)

// Consolidated approval dashboard
router.get('/approvals', getApprovalQueue)

// User management
router.get('/users', listUsers)
router.patch('/users/:id/suspend', suspendUser)
router.patch('/users/:id/unsuspend', unsuspendUser)

// Organizer approval
router.get('/organizers/pending', listPendingOrganizers)
router.get('/organizers/:id/review', getOrganizerReview)
router.patch('/organizers/:id/approve', approveOrganizer)
router.patch('/organizers/:id/reject', rejectOrganizer)

// Event approval
router.get('/events/pending', listPendingEvents)
router.get('/events/:id/review', getEventReview)
router.patch('/events/:id/approve', approveEvent)
router.patch('/events/:id/reject', validateFormData(rejectEventSchema), rejectEvent)

// Event moderation
router.patch('/events/:id/suspend', validateFormData(suspendEventSchema), suspendEvent)
router.patch('/events/:id/unsuspend', unsuspendEvent)

// Promotion approval
router.get('/promotions/pending', listPendingPromotions)
router.patch('/events/:id/promotion/approve', approveEventPromotion)
router.patch('/events/:id/promotion/reject', rejectEventPromotion)

// Refund requests
router.get('/refund-requests', listRefundRequests)
router.get('/refund-requests/:id', getRefundRequest)
router.patch(
  '/refund-requests/:id/approve',
  customRateLimiter(3),
  validateFormData(approveRefundRequestSchema),
  approveRefundRequest,
)
router.patch(
  '/refund-requests/:id/reject',
  validateFormData(rejectRefundRequestSchema),
  rejectRefundRequest
)

// Organizer payouts
router.post(
  '/payouts/events/:eventId/initiate',
  customRateLimiter(3),
  validateFormData(
    initiatePayoutSchema,
  ),
  initiateEventPayout,
)

export default router
