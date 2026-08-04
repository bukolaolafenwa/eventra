import { Request, Response } from 'express'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import { categoryService } from '../services/category.service.js'
import { logError } from '../config/logger.js'

/**
 * POST /api/v1/categories
 * Creates a new category. Organizer/admin only (guarded at route level).
 */
export const createCategory = tryCatchWrapper(async (req: Request, res: Response) => {
  const category = await categoryService.createCategory(req.body)

  sendTsRestSuccess(res, 201, {
    success: true,
    message: 'Category created successfully',
    body: { category },
  })
})

/**
 * GET /api/v1/categories
 * Public. Supports pagination, ?isActive=true/false, and ?search=term.
 */
export const getCategories = tryCatchWrapper(async (req: Request, res: Response) => {
  const page = Number(req.query.page) || 1
  const limit = Number(req.query.limit) || 10

  // Query params arrive as strings, so isActive needs explicit parsing
  // rather than a truthy check ("false" is truthy as a string).
  let isActive: boolean | undefined
  if (req.query.isActive === 'true') isActive = true
  if (req.query.isActive === 'false') isActive = false

  const search = typeof req.query.search === 'string' ? req.query.search : undefined

  const { categories, total } = await categoryService.getCategories({ page, limit, isActive, search })

  const totalPages = Math.ceil(total / limit)

  sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Categories retrieved successfully',
    body: {
      categories,
      meta: {
        currentPage: page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages,
      },
    },
  })
})

/**
 * GET /api/v1/categories/:id
 * Public. `:id` may be a Mongo ObjectId or a slug — service handles both.
 */
export const getCategory = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }

  const category = await categoryService.getCategory(id)

  if (!category) {
    sendTsRestError(res, 404, 'Category not found')
    return
  }

  sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Category retrieved successfully',
    body: { category },
  })
})

/**
 * PATCH /api/v1/categories/:id
 * Organizer/admin only (guarded at route level).
 */
export const updateCategory = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }

  const category = await categoryService.updateCategory(id, req.body)

  if (!category) {
    sendTsRestError(res, 404, 'Category not found')
    return
  }

  sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Category updated successfully',
    body: { category },
  })
})
/**
 * DELETE /api/v1/categories/:id
 * Organizer/admin only (guarded at route level).
 */
export const deleteCategory = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }

  const category = await categoryService.deleteCategory(id)

  if (!category) {
    sendTsRestError(res, 404, 'Category not found')
    return
  }

  sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Category deleted successfully',
    body: { message: 'Category deleted successfully' },
  })
})