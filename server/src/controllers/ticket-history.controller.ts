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
import { ticketHistoryService } from '../services/ticket-history.service.js'

interface TicketHistoryQuery {
  [key: string]: string | undefined
  page?: string
  limit?: string
  view?: string
}

/**
 * Retrieves the authenticated attendee's tickets.
 *
 * Supported views:
 * - upcoming (default)
 * - past
 * - all
 */
export const listMyTickets = tryCatchWrapper(
  async (
    req: Request<
      Record<string, never>,
      unknown,
      unknown,
      TicketHistoryQuery
    >,
    res: Response,
  ) => {
    const userId = req.session.userId

    if (!userId) {
      sendTsRestError(
        res,
        401,
        'Unauthorized: please log in to continue',
      )
      return
    }

    const {
      page,
      limit,
      skip,
    } = getPagination(
      req.query as Record<string, unknown>,
    )

    const result =
      await ticketHistoryService.listMyTickets(
        userId,
        {
          page,
          limit,
          skip,
          view: req.query.view,
        },
      )

    sendTsRestSuccess(res, 200, {
      success: true,
      message:
        'Ticket history retrieved successfully',
      body: {
        tickets: result.tickets,
        meta: buildPaginationMeta(
          page,
          limit,
          result.total,
        ),
      },
    })
  },
)