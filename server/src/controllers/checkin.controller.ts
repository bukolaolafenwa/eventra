import type { Request, Response } from 'express'

import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import { checkInService } from '../services/checkin.service.js'

interface CheckInParams {
  eventId: string
}

interface CheckInBody {
  code: string
}

/**
 * Checks an attendee into an organizer-owned event using a ticket code.
 */
export const checkInTicket = tryCatchWrapper(
  async (
    req: Request<
      CheckInParams,
      unknown,
      CheckInBody
    >,
    res: Response,
  ) => {
    const { eventId } = req.params
    const { code } = req.body
    const organizerId = req.session.userId

    if (!organizerId) {
      return sendTsRestError(
        res,
        401,
        'Unauthorized: please log in to continue',
      )
    }

    const ticket =
      await checkInService.checkInTicket(
        eventId,
        organizerId,
        code,
      )

    return sendTsRestSuccess(res, 200, {
      success: true,
      message: 'Attendee checked in successfully',
      body: ticket,
    })
  },
)