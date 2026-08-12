import { Request, Response } from 'express'

import {
  CreateReservationInput,
  reservationService,
} from '../services/reservation.service.js'
import { sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'

interface ReservationParams {
  eventId: string
}

interface ReservationBody {
  customer: CreateReservationInput['customer']
  quantity: number
}

export const createReservation = tryCatchWrapper(
  async (
    req: Request<
      ReservationParams,
      unknown,
      ReservationBody
    >,
    res: Response,
  ) => {
    const reservation =
      await reservationService.createReservation({
        eventId: req.params.eventId,

        // The route is public. A logged-in attendee's session connects
        // the reservation to their account; guests remain email-based.
        buyerId: req.session.userId,

        customer: req.body.customer,
        quantity: req.body.quantity,
      })

    return sendTsRestSuccess(res, 201, {
      success: true,
      message: reservation.emailSent
        ? 'Reservation confirmed and tickets sent by email'
        : 'Reservation confirmed; tickets were issued but the email could not be sent',
      body: reservation,
    })
  },
)