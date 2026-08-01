import { Router } from 'express'

import { createCategoryController } from '../controllers/category.controller.js'

import {
  verifySession,
  requireAdmin,
} from '../middlewares/auth.middleware.js'

import { validateFormData } from '../middlewares/schema.middleware.js'
import { customRateLimiter } from '../middlewares/rateLimit.middleware.js'
import { clearCache } from '../middlewares/cache.middleware.js'

import { createCategorySchema } from '../lib/schemaValidation.js'



const router = Router()

/**
 * @route   POST /api/v1/categories
 * @desc    Create a new category
 * @access  Admin
 */
router.post(
  '/',
  customRateLimiter(5),
  verifySession,
  requireAdmin,
  validateFormData(createCategorySchema),
  clearCache('categories'),
  createCategoryController
)

export default router