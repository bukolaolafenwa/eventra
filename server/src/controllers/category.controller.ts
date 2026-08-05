import type { Request, Response, NextFunction } from 'express'
import { createCategory, getAllCategories, getCategoryById, updateCategory, deleteCategory, } from '../services/category.service.js'
import { sendTsRestSuccess } from '../lib/responseHandler.js'
import type { CreateCategoryInput, UpdateCategoryInput, } from '../types/category.types.js'

type CategoryParams = {
  id: string
}

/**
 * Creates a new category.
 */
export const createCategoryController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const payload = req.body as CreateCategoryInput

    const category = await createCategory(payload)

    sendTsRestSuccess(res, 201, {
      success: true,
      message: 'Category created successfully',
      body: category,
    })
  } catch (error) {
    next(error)
  }
}


/**
 * Retrieves all categories.
 */
export const getAllCategoriesController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const categories = await getAllCategories()

    sendTsRestSuccess(res, 200, {
      success: true,
      message: 'Categories retrieved successfully',
      body: categories,
    })
  } catch (error) {
    next(error)
  }
}


/**
 * Retrieves a category by its ID.
 */

export const getCategoryByIdController = async (
  req: Request<CategoryParams>,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params

    const category = await getCategoryById(id)

    sendTsRestSuccess(res, 200, {
      success: true,
      message: 'Category retrieved successfully',
      body: category,
    })
  } catch (error) {
    next(error)
  }
}


/**
 * Updates an existing category.
 */
export const updateCategoryController = async (
  req: Request<CategoryParams, unknown, UpdateCategoryInput>,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params

    const payload = req.body

    const category = await updateCategory(id, payload)

    sendTsRestSuccess(res, 200, {
      success: true,
      message: 'Category updated successfully',
      body: category,
    })
  } catch (error) {
    next(error)
  }
}


/**
 * Deactivates a category (soft delete).
 */
export const deleteCategoryController = async (
  req: Request<CategoryParams>,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params

    const category = await deleteCategory(id)

    sendTsRestSuccess(res, 200, {
      success: true,
      message: 'Category deactivated successfully',
      body: category,
    })
  } catch (error) {
    next(error)
  }
}