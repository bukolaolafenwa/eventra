import mongoose from 'mongoose'

import { ErrorResponse } from '../middlewares/error.middleware.js'
import Ticket from '../models/ticket.js'

export interface TicketHistoryQuery {
  page: number
  limit: number
  skip: number
  view?: string
}

export interface TicketHistoryResult {
  tickets: unknown[]
  total: number
}

const HISTORY_VIEWS = [
  'all',
  'upcoming',
  'past',
] as const

export class TicketHistoryService {
  private validateObjectId(
    id: string,
    label: string,
  ): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ErrorResponse(
        `Invalid ${label} ID`,
        400,
      )
    }
  }

  async listMyTickets(
    userId: string,
    query: TicketHistoryQuery,
  ): Promise<TicketHistoryResult> {
    this.validateObjectId(userId, 'user')

    const selectedView =
      query.view?.trim().toLowerCase() ||
      'upcoming'

    if (
      !HISTORY_VIEWS.includes(
        selectedView as
          typeof HISTORY_VIEWS[number],
      )
    ) {
      throw new ErrorResponse(
        'Invalid ticket-history view',
        400,
      )
    }

    const now = new Date()

    const dateFilter: Record<string, unknown> =
      {}

    if (selectedView === 'upcoming') {
      dateFilter['event.startDate'] = {
        $gte: now,
      }
    }

    if (selectedView === 'past') {
      dateFilter['event.startDate'] = {
        $lt: now,
      }
    }

    const sortDirection =
      selectedView === 'past' ? -1 : 1

    const pipeline: mongoose.PipelineStage[] = [
      {
        $match: {
          attendee:
            new mongoose.Types.ObjectId(
              userId,
            ),
        },
      },
      {
        $lookup: {
          from: 'events',
          localField: 'event',
          foreignField: '_id',
          as: 'event',
        },
      },
      {
        $unwind: '$event',
      },
      {
        $match: dateFilter,
      },
      {
        $lookup: {
          from: 'orders',
          localField: 'order',
          foreignField: '_id',
          as: 'order',
        },
      },
      {
        $unwind: '$order',
      },
      {
        $lookup: {
          from: 'categories',
          localField: 'event.category',
          foreignField: '_id',
          as: 'category',
        },
      },
      {
        $unwind: {
          path: '$category',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $sort: {
          'event.startDate': sortDirection,
          createdAt: -1,
        },
      },
      {
        $facet: {
          tickets: [
            {
              $skip: query.skip,
            },
            {
              $limit: query.limit,
            },
            {
              $project: {
                _id: 1,
                ticketId: 1,
                code: 1,
                sequence: 1,
                ticketTypeName: 1,
                pricePaid: 1,
                currency: 1,
                status: 1,
                issuedAt: 1,
                checkedInAt: 1,
                cancelledAt: 1,
                refundedAt: 1,

                event: {
                  _id: '$event._id',
                  title: '$event.title',
                  slug: '$event.slug',
                  type: '$event.type',
                  status: '$event.status',
                  coverImage:
                    '$event.coverImage',
                  startDate:
                    '$event.startDate',
                  endDate: '$event.endDate',
                  venue: '$event.venue',
                  refundPolicy:
                    '$event.refundPolicy',
                  category: {
                    _id: '$category._id',
                    name: '$category.name',
                    slug: '$category.slug',
                  },
                },

                order: {
                  _id: '$order._id',
                  orderNumber:
                    '$order.orderNumber',
                  type: '$order.type',
                  status: '$order.status',
                  subtotal:
                    '$order.subtotal',
                  serviceFee:
                    '$order.serviceFee',
                  totalAmount:
                    '$order.totalAmount',
                  currency:
                    '$order.currency',
                  paidAt: '$order.paidAt',
                  confirmedAt:
                    '$order.confirmedAt',
                },
              },
            },
          ],

          count: [
            {
              $count: 'total',
            },
          ],
        },
      },
    ]

    const results = await Ticket.aggregate<{
      tickets: unknown[]
      count: Array<{ total: number }>
    }>(pipeline)

    const result = results[0]

    return {
      tickets: result?.tickets ?? [],
      total:
        result?.count[0]?.total ?? 0,
    }
  }
}

export const ticketHistoryService =
  new TicketHistoryService()