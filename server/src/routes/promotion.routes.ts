import { Router } from 'express'
import { listMyPromotions, listPromotionPackages } from '../controllers/promotion.controller.js'
import { verifySession, requireRole } from '../middlewares/auth.middleware.js'

const router = Router()

router.get('/packages', listPromotionPackages)

/**
 * @route   GET /api/v1/promotions/mine
 * @desc    Every event belonging to this organizer that has (or had) a promotion
 * @access  Organizer
 */
router.get('/mine', verifySession, requireRole('organizer'), listMyPromotions)

export default router
