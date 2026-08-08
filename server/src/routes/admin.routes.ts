import { Router } from 'express'
import {
  approveEvent,
  approveEventPromotion,
  approveOrganizer,
  getPlatformStats,
  listPendingEvents,
  listPendingOrganizers,
  listUsers,
  rejectEvent,
  rejectEventPromotion,
  rejectOrganizer,
  suspendUser,
  unsuspendUser,
} from '../controllers/admin.controller.js'
import { requireAdmin, verifySession } from '../middlewares/auth.middleware.js'
import { validateFormData } from '../middlewares/schema.middleware.js'
import { createCategorySchema, rejectEventSchema, updateCategorySchema } from '../lib/schemaValidation.js'

const router = Router()

router.use(verifySession, requireAdmin)

// Platform stats
router.get('/stats', getPlatformStats)

// User management
router.get('/users', listUsers)
router.patch('/users/:id/suspend', suspendUser)
router.patch('/users/:id/unsuspend', unsuspendUser)

// Organizer approval
router.get('/organizers/pending', listPendingOrganizers)
router.patch('/organizers/:id/approve', approveOrganizer)
router.patch('/organizers/:id/reject', rejectOrganizer)

// Event approval
router.get('/events/pending', listPendingEvents)
router.patch('/events/:id/approve', approveEvent)
router.patch('/events/:id/reject', validateFormData(rejectEventSchema), rejectEvent)

// Promotion approval
router.patch('/events/:id/promotion/approve', approveEventPromotion)
router.patch('/events/:id/promotion/reject', rejectEventPromotion)

export default router
