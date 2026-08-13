import mongoose from 'mongoose'

import { ErrorResponse } from '../middlewares/error.middleware.js'
import Event from '../models/event.js'
import Ticket from '../models/ticket.js'

export interface AttendeeListQuery {
  page: number
  limit: number
  skip: number
  search?: string
  status?: string
  ticketTypeId?: string
}

export interface AttendeeSummary {
  totalTickets: number
  checkedInCount: number
  activeCount: number
  cancelledCount: number
  refundedCount: number
}

export interface AttendeeListResult {
  attendees: unknown[]
  total: number
  summary: AttendeeSummary
}

const TICKET_STATUSES = [
  'active',
  'used',
  'cancelled',
  'refunded',
] as const

export class AttendeeService {
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

  private escapeRegExp(value: string): string {
    return value.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    )
  }

  async listEventAttendees(
    eventId: string,
    organizerId: string,
    query: AttendeeListQuery,
  ): Promise<AttendeeListResult> {
    this.validateObjectId(eventId, 'event')
    this.validateObjectId(
      organizerId,
      'organizer',
    )

    const event = await Event.findOne({
      _id: eventId,
      organizer: organizerId,
    })
      .select('_id')
      .lean()

    if (!event) {
      throw new ErrorResponse(
        'Event not found or you do not own this event',
        404,
      )
    }

    const filter: Record<string, unknown> = {
      event: event._id,
    }

    if (query.status) {
      if (
        !TICKET_STATUSES.includes(
          query.status as typeof TICKET_STATUSES[number],
        )
      ) {
        throw new ErrorResponse(
          'Invalid ticket status',
          400,
        )
      }

      filter.status = query.status
    }

    if (query.ticketTypeId) {
      this.validateObjectId(
        query.ticketTypeId,
        'ticket type',
      )

      filter.ticketType =
        new mongoose.Types.ObjectId(
          query.ticketTypeId,
        )
    }

    const normalizedSearch =
      query.search?.trim()

    if (normalizedSearch) {
      const searchPattern = new RegExp(
        this.escapeRegExp(normalizedSearch),
        'i',
      )

      filter.$or = [
        { ticketId: searchPattern },
        { attendeeName: searchPattern },
        { attendeeEmail: searchPattern },
        { attendeePhone: searchPattern },
        { code: searchPattern },
        { ticketTypeName: searchPattern },
      ]
    }

    const eventFilter = {
      event: event._id,
    }

    const [
      attendees,
      total,
      statusCounts,
    ] = await Promise.all([
      Ticket.find(filter)
        .select(
          [
            'ticketId',
            '_id',
            'order',
            'attendee',
            'attendeeName',
            'attendeeEmail',
            'attendeePhone',
            'ticketType',
            'ticketTypeName',
            'code',
            'pricePaid',
            'currency',
            'status',
            'issuedAt',
            'checkedInAt',
            'checkedInBy',
            'createdAt',
          ].join(' '),
        )
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .lean(),

      Ticket.countDocuments(filter),

      Ticket.aggregate<{
        _id: string
        count: number
      }>([
        {
          $match: eventFilter,
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
      ]),
    ])

    const counts = new Map(
      statusCounts.map(item => [
        item._id,
        item.count,
      ]),
    )

    const activeCount =
      counts.get('active') ?? 0

    const checkedInCount =
      counts.get('used') ?? 0

    const cancelledCount =
      counts.get('cancelled') ?? 0

    const refundedCount =
      counts.get('refunded') ?? 0

    return {
      attendees,
      total,
      summary: {
        totalTickets:
          activeCount +
          checkedInCount +
          cancelledCount +
          refundedCount,
        checkedInCount,
        activeCount,
        cancelledCount,
        refundedCount,
      },
    }
  }
}

export const attendeeService =
  new AttendeeService()