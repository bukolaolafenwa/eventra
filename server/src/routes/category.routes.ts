import { Router } from 'express'
import {
  createCategory,
  getCategories,
  getCategory,
  updateCategory,
  deleteCategory,
} from '../controllers/category.controller.js'
import { verifySession, requireRole } from '../middlewares/auth.middleware.js'
import { validateFormData } from '../lib/schemaValidation.js'
import { createCategorySchema, updateCategorySchema } from '../lib/schemaValidation.js'
import { customRateLimiter } from '../middlewares/rateLimit.middleware.js'
import { cacheMiddleware, clearCache } from '../middlewares/cache.middleware.js'

const router = Router()

// GET /api/v1/categories — public, cached for 60s
router.get('/', customRateLimiter(60), cacheMiddleware(60), getCategories)

// GET /api/v1/categories/:id — public (accepts ObjectId or slug), cached for 60s
router.get('/:id', customRateLimiter(60), cacheMiddleware(60), getCategory)

// POST /api/v1/categories — organizer/admin only
router.post(
  '/',
  customRateLimiter(20),
  verifySession,
  requireRole('organizer'),
  validateFormData(createCategorySchema),
  clearCache('category'),
  createCategory,
)

// PATCH /api/v1/categories/:id — organizer/admin only
router.patch(
  '/:id',
  customRateLimiter(20),
  verifySession,
  requireRole('organizer'),
  validateFormData(updateCategorySchema),
  clearCache('category'),
  updateCategory,
)

// DELETE /api/v1/categories/:id — organizer/admin only
router.delete(
  '/:id',
  customRateLimiter(20),
  verifySession,
  requireRole('organizer'),
  clearCache('category'),
  deleteCategory,
)

export default router