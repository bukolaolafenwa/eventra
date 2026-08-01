import type { NextFunction, Request, Response } from 'express'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import { createEvent as createEventService } from '../services/event.service.js'
import type { CreateEventInput } from '../types/event.types.js'

/**
 * Creates a new event.
 *
 * Responsibilities:
 * - Get authenticated organizer
 * - Call the service layer
 * - Return a success response
 */
export const createEvent = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const organizerId = req.session.userId

    // This should never happen because verifySession runs first,
    // but it keeps the controller safe and satisfies TypeScript.
    if (!organizerId) {
      sendTsRestError(res, 401, 'Unauthorized: please log in to continue')
      return
    }

    const event = await createEventService(
      organizerId,
      req.body as CreateEventInput
    )

    sendTsRestSuccess(res, 201, {
      success: true,
      message: 'Event created successfully',
      body: event,
    })
  } catch (error) {
    next(error)
  }
}