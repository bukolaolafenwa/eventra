import { z } from 'zod'
import {
  createCategorySchema,
  updateCategorySchema,
} from '../lib/schemaValidation.js'

/**
 * Request payload for creating a category.
 * Derived from the Zod schema to keep validation and types in sync.
 */
export type CreateCategoryInput = z.infer<typeof createCategorySchema>

/**
 * Request payload for updating a category.
 */
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>


/**
 * Query parameters for filtering categories.
 */
export interface CategoryFilters {
  isActive?: boolean
  search?: string
}