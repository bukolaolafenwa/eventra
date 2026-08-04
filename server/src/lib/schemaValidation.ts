import { Request, Response, NextFunction } from 'express'
import { z, ZodSchema } from 'zod'
import { sendTsRestError } from './responseHandler.js'

/**
 * Generic request-body validation middleware.
 * Takes any Zod schema and validates `req.body` against it before
 * the request reaches the controller.
 *
 * Usage:
 *   router.post('/categories', validateFormData(createCategorySchema), createCategory)
 */
export const validateFormData = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body)

    if (!result.success) {
      const details = result.error.issues.map(issue => ({
        field: issue.path.join('.'),
        message: issue.message,
      }))

      sendTsRestError(res, 400, 'Validation failed', details)
      return
    }

    req.body = result.data
    next()
  }
}

// ─── Category schemas ───────────────────────────────────────────

export const createCategorySchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(50, 'Name is too long'),
  description: z.string().trim().max(300, 'Description is too long').optional(),
  icon: z.string().trim().optional(),
  isActive: z.boolean().optional(),
})

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(50, 'Name is too long').optional(),
    description: z.string().trim().max(300, 'Description is too long').optional(),
    icon: z.string().trim().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(data => Object.keys(data).length > 0, { message: 'At least one field must be provided' })

/*
 * WHAT THIS FILE DOES:
 * This is the single, reusable "gatekeeper" for incoming request data —
 * both the generic middleware (validateFormData) and the specific Zod
 * schemas describing what a valid request body looks like for each
 * resource, starting with Category.
 *
 * WHY IT MATTERS FOR EVENTRA:
 * Centralizing validation here means bad data (missing name, wrong types,
 * malicious payloads) never reaches the database or business logic, and
 * every route rejects invalid input the same consistent way — matching
 * the { success: false, message: "Validation failed", details: [...] }
 * shape required by the project's coding conventions.
 *
 * NOTE: This file didn't exist yet in the repo, so I built it to match
 * what the Auth Controller guide implies (Zod-based validateFormData).
 * As other schemas get added (registerSchema, loginSchema, eventSchema,
 * etc.) by other devs, they should live here too, following the same
 * pattern — one exported schema per resource/action.
 */