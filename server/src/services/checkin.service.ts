import mongoose from 'mongoose'

import { ErrorResponse } from '../middlewares/error.middleware.js'
import Event from '../models/event.js'
import Ticket from '../models/ticket.js'

export interface CheckInResult {
  ticketId: string
  code: string
  attendeeName: string
  attendeeEmail: string
  ticketTypeName: string
  status: 'used'
  checkedInAt: Date
  checkedInBy: mongoose.Types.ObjectId
}

export class CheckInService {
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

  async checkInTicket(
    eventId: string,
    organizerId: string,
    code: string,
  ): Promise<CheckInResult> {
    this.validateObjectId(eventId, 'event')
    this.validateObjectId(organizerId, 'organizer')

    const normalizedCode = code
      .trim()
      .toUpperCase()

    if (!normalizedCode) {
      throw new ErrorResponse(
        'Ticket code is required',
        400,
      )
    }

    const event = await Event.findOne({
      _id: eventId,
      organizer: organizerId,
    })
      .select('_id status')
      .lean()

    if (!event) {
      throw new ErrorResponse(
        'Event not found or you do not own this event',
        404,
      )
    }

    if (
      event.status === 'cancelled' ||
      event.status === 'suspended'
    ) {
      throw new ErrorResponse(
        `Tickets cannot be checked in for a ${event.status} event`,
        409,
      )
    }

    /*
     * The status condition makes check-in atomic. If two requests scan
     * the same ticket simultaneously, only one can change it from
     * active to used.
     */
    const checkedInAt = new Date()

    const checkedInTicket =
      await Ticket.findOneAndUpdate(
        {
          event: event._id,
          code: normalizedCode,
          status: 'active',
        },
        {
          $set: {
            status: 'used',
            checkedInAt,
            checkedInBy: organizerId,
          },
        },
        {
          new: true,
          runValidators: true,
        },
      )
        .select(
  'ticketId code attendeeName attendeeEmail ticketTypeName status checkedInAt checkedInBy',
)
        .lean()

    if (!checkedInTicket) {
      const existingTicket = await Ticket.findOne({
        event: event._id,
        code: normalizedCode,
      })
        .select('status checkedInAt')
        .lean()

      if (!existingTicket) {
        throw new ErrorResponse(
          'Ticket not found for this event',
          404,
        )
      }

      if (existingTicket.status === 'used') {
        throw new ErrorResponse(
          'This ticket has already been checked in',
          409,
        )
      }

      if (existingTicket.status === 'cancelled') {
        throw new ErrorResponse(
          'This ticket has been cancelled',
          409,
        )
      }

      if (existingTicket.status === 'refunded') {
        throw new ErrorResponse(
          'This ticket has been refunded',
          409,
        )
      }

      throw new ErrorResponse(
        'This ticket cannot be checked in',
        409,
      )
    }

    if (
      !checkedInTicket.checkedInAt ||
      !checkedInTicket.checkedInBy
    ) {
      throw new ErrorResponse(
        'Ticket check-in could not be completed',
        500,
      )
    }

    return {
      ticketId: checkedInTicket.ticketId,
      code: checkedInTicket.code,
      attendeeName:
        checkedInTicket.attendeeName,
      attendeeEmail:
        checkedInTicket.attendeeEmail,
      ticketTypeName:
        checkedInTicket.ticketTypeName,
      status: 'used',
      checkedInAt:
        checkedInTicket.checkedInAt,
      checkedInBy:
        checkedInTicket.checkedInBy,
    }
  }
}

export const checkInService =
  new CheckInService()