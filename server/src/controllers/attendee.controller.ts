import type { Request, Response } from 'express'

import {
  sendTsRestError,
  sendTsRestSuccess,
} from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import {
  buildPaginationMeta,
  getPagination,
} from '../lib/utils.js'
import { attendeeService } from '../services/attendee.service.js'

interface AttendeeParams {
  eventId: string
}

interface AttendeeQuery {
  page?: string
  limit?: string
  search?: string
  status?: string
  ticketTypeId?: string
}

/**
 * Retrieves the attendees and ticket statistics for an
 * organizer-owned event.
 */
export const listEventAttendees =
  tryCatchWrapper(
    async (
      req: Request<
        AttendeeParams,
        unknown,
        unknown,
        AttendeeQuery
      >,
      res: Response,
    ) => {
      const { eventId } = req.params
      const organizerId =
        req.session.userId

      if (!organizerId) {
        return sendTsRestError(
          res,
          401,
          'Unauthorized: please log in to continue',
        )
      }

      const {
        page,
        limit,
        skip,
      } = getPagination(
        req.query as Record<string, unknown>,
      )

      const result =
        await attendeeService.listEventAttendees(
          eventId,
          organizerId,
          {
            page,
            limit,
            skip,
            search: req.query.search,
            status: req.query.status,
            ticketTypeId:
              req.query.ticketTypeId,
          },
        )

      return sendTsRestSuccess(res, 200, {
        success: true,
        message:
          'Event attendees retrieved successfully',
        body: {
          attendees: result.attendees,
          summary: result.summary,
          meta: buildPaginationMeta(
            page,
            limit,
            result.total,
          ),
        },
      })
    },
  )