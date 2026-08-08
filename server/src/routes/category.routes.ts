import { Router } from 'express'

import {
  createCategoryController,
  getAllCategoriesController,
  getAllCategoriesAdminController,
   getCategoryByIdController,
     updateCategoryController,
    deleteCategoryController,
    restoreCategoryController,
    
} from '../controllers/category.controller.js'

import {
  verifySession,
  requireAdmin,
} from '../middlewares/auth.middleware.js'

import { validateFormData } from '../middlewares/schema.middleware.js'
import { customRateLimiter } from '../middlewares/rateLimit.middleware.js'
import { clearCache } from '../middlewares/cache.middleware.js'

import { createCategorySchema, updateCategorySchema, } from '../lib/schemaValidation.js'

const router = Router()

/**
 * @route   GET /api/v1/categories
 * @desc    Retrieve all categories
 * @access  Public
 */
router.get('/', getAllCategoriesController)



/**
 * @route   GET /api/v1/categories/admin
 * @desc    Retrieve all categories (including inactive)
 * @access  Admin
 */
router.get(
  '/admin',
  verifySession,
  requireAdmin,
  getAllCategoriesAdminController
)



/**
 * @route   GET /api/v1/categories/:id
 * @desc    Retrieve a category by ID
 * @access  Public
 */
router.get('/:id', getCategoryByIdController)


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


/**
 * @route   PATCH /api/v1/categories/:id
 * @desc    Update an existing category
 * @access  Admin
 */
router.patch(
  '/:id',
  customRateLimiter(5),
  verifySession,
  requireAdmin,
  validateFormData(updateCategorySchema),
  clearCache('categories'),
  updateCategoryController
)


/**
 * @route   DELETE /api/v1/categories/:id
 * @desc    Deactivate a category (soft delete)
 * @access  Admin
 */
router.delete(
  '/:id',
  customRateLimiter(5),
  verifySession,
  requireAdmin,
  clearCache('categories'),
  deleteCategoryController
)



/**
 * @route   PATCH /api/v1/categories/:id/restore
 * @desc    Restore a deactivated category
 * @access  Admin
 */
router.patch(
  '/:id/restore',
  customRateLimiter(5),
  verifySession,
  requireAdmin,
  clearCache('categories'),
  restoreCategoryController
)


export default router