import { Request, Response } from 'express'
import { categoryService } from '../services/category.service.js'
import { sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import type { CreateCategoryInput, UpdateCategoryInput } from '../types/category.types.js'

type CategoryParams = { id: string }

/**
 * Creates a new category.
 */
export const createCategoryController = tryCatchWrapper(async (req: Request, res: Response) => {
  const payload = req.body as CreateCategoryInput
  const category = await categoryService.createCategory(payload)

  return sendTsRestSuccess(res, 201, {
    success: true,
    message: 'Category created successfully',
    body: category,
  })
})

/**
 * Retrieves all categories.
 */
export const getAllCategoriesController = tryCatchWrapper(async (req: Request, res: Response) => {
  const categories = await categoryService.getAllCategories()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Categories retrieved successfully',
    body: categories,
  })
})

/**
 * Retrieves all categories (including inactive). Admin only.
 */
export const getAllCategoriesAdminController = tryCatchWrapper(async (req: Request, res: Response) => {
  const categories = await categoryService.getAllCategories(true)

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'All categories retrieved successfully',
    body: categories,
  })
})

/**
 * Retrieves a category by its ID.
 */
export const getCategoryByIdController = tryCatchWrapper(async (req: Request<CategoryParams>, res: Response) => {
  const { id } = req.params
  const category = await categoryService.getCategoryById(id)

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Category retrieved successfully',
    body: category,
  })
})

/**
 * Updates an existing category.
 */
export const updateCategoryController = tryCatchWrapper(
  async (req: Request<CategoryParams, unknown, UpdateCategoryInput>, res: Response) => {
    const { id } = req.params
    const category = await categoryService.updateCategory(id, req.body)

    return sendTsRestSuccess(res, 200, {
      success: true,
      message: 'Category updated successfully',
      body: category,
    })
  }
)

/**
 * Deactivates a category (soft delete).
 */
export const deleteCategoryController = tryCatchWrapper(async (req: Request<CategoryParams>, res: Response) => {
  const { id } = req.params
  const category = await categoryService.deleteCategory(id)

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Category deactivated successfully',
    body: category,
  })
})

/**
 * Restores a deactivated category.
 */
export const restoreCategoryController = tryCatchWrapper(async (req: Request<CategoryParams>, res: Response) => {
  const { id } = req.params
  const category = await categoryService.restoreCategory(id)

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Category restored successfully',
    body: category,
  })
})