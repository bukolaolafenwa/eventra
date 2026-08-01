import { z } from 'zod'
import {
  createEventSchema,
  updateEventSchema,
} from '../lib/schemaValidation.js'

/**
 * Request payload for creating an event.
 * Derived from the Zod schema to keep validation and types in sync.
 */
export type CreateEventInput = z.infer<typeof createEventSchema>

/**
 * Request payload for updating an event.
 */
export type UpdateEventInput = z.infer<typeof updateEventSchema>

/**
 * Query parameters for filtering events.
 */
export interface EventFilters {
  category?: string
  type?: 'free' | 'paid'
  city?: string
  status?:
    | 'draft'
    | 'pending_approval'
    | 'approved'
    | 'rejected'
    | 'cancelled'
    | 'postponed'
  organizer?: string
  startDate?: Date
  endDate?: Date
  minPrice?: number
  maxPrice?: number
  search?: string
}

/**
 * Pagination options.
 */
export interface PaginationOptions {
  page?: number
  limit?: number
}

/**
 * Generic paginated response.
 */
export interface PaginatedResponse<T> {
  data: T[]
  page: number
  limit: number
  total: number
  totalPages: number
}