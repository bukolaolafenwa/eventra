import type { Request, Response, NextFunction } from 'express'

import { createCategory } from '../services/category.service.js'

import { sendTsRestSuccess } from '../lib/responseHandler.js'

import type { CreateCategoryInput } from '../types/category.types.js'


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