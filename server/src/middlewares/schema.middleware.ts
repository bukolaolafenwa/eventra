import type { NextFunction, Request, Response } from 'express'
import type { ZodTypeAny } from 'zod'
import { sendTsRestError } from '../lib/responseHandler.js'

type RequestTarget = 'body' | 'params' | 'query'

/**
 * Validates request data against a Zod schema.
 *
 * Defaults to validating req.body but can also validate
 * req.params and req.query.
 *
 * Examples:
 *
 * validateFormData(createEventSchema)
 * validateFormData(idSchema, 'params')
 * validateFormData(filterSchema, 'query')
 */
export const validateFormData = (
  schema: ZodTypeAny,
  target: RequestTarget = 'body'
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target])

    if (!result.success) {
      const details = result.error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message,
      }))

      sendTsRestError(res, 400, 'Validation failed', details)
      return
    }

    req[target] = result.data

    next()
  }
}