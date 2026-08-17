import bcrypt from 'bcrypt'
import { Request, Response } from 'express'

import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import Event from '../models/event.js'
import Order from '../models/order.js'
import RefundRequest from '../models/refundRequest.js'
import Ticket from '../models/ticket.js'
import { paymentService } from '../services/payment.service.js'
import { ticketBelongsToRequester } from '../lib/attendee.js'
import { generateQrCodeBuffer, generateQrCodeDataUrl } from '../lib/qrcode.js'
import { checkRefundEligibility } from '../lib/refundPolicy.js'
import { generateOTP, isValidObjectId } from '../lib/utils.js'
import GuestAccessCode from '../models/guestAccessCode.js'
import { EmailService } from '../services/email.service.js'
import logger from '../config/logger.js'

// A ticket-identifier helper
// Support public TK_IDs and legacy MongoDB ticket IDs.
const buildTicketLookup = (
  identifier: string | string[] | undefined,
): { ticketId: string } | { _id: string } | null => {
  if (typeof identifier !== 'string') {
    return null
  }

  const trimmedIdentifier = identifier.trim()

  if (!trimmedIdentifier) {
    return null
  }

  const normalizedIdentifier =
    trimmedIdentifier.toUpperCase()

  if (normalizedIdentifier.startsWith('TK_')) {
    return {
      ticketId: normalizedIdentifier,
    }
  }

  if (isValidObjectId(trimmedIdentifier)) {
    return {
      _id: trimmedIdentifier,
    }
  }

  return null
}

/**
 * Lets the client poll "did my payment go through?" after Paystack redirects
 * back to /checkout/confirmation?reference=... . The webhook
 * (handlePaystackWebhook in payment.controller.ts) is what's *supposed* to
 * flip order status — but webhook delivery needs Paystack's servers to
 * reach ours, which isn't guaranteed (local dev, a stale dashboard URL, a
 * dropped delivery). So whenever this finds a still-'pending' order, it
 * re-runs that same reconciliation itself (paymentService.confirmPaystackPayment,
 * the same function the webhook calls) before responding — self-healing the
 * poll instead of leaving the client stuck watching a status that will
 * never change on its own. Still never trusts the client for this:
 * reconciliation always re-verifies directly against Paystack's API.
 */
export const getOrderByReference = tryCatchWrapper(async (req: Request, res: Response) => {
  const { reference } = req.params

  // Logged in: still scoped to their own orders, same as before. No
  // session (guest checkout): the reference itself — an unguessable,
  // randomly-generated string only ever shown to whoever completed this
  // specific checkout — is treated as the access key, same trust model as
  // a payment receipt link.
  const filter = req.session?.userId
    ? { paystackReference: reference, buyer: req.session.userId }
    : { paystackReference: reference }

  let order = await Order.findOne(filter).populate('event', 'title slug startDate venue coverImage').lean()

  if (!order) {
    return sendTsRestError(res, 404, 'Order not found')
  }

  if (order.status === 'pending') {
    try {
      await paymentService.confirmPaystackPayment(reference as string)
    } catch (error: any) {
      // Paystack's API might just be slow/unreachable this instant, or the
      // payment genuinely hasn't succeeded yet — leave the order 'pending'
      // and let the next poll (or the webhook, if it does eventually land)
      // try again rather than failing this request.
      logger.error(`getOrderByReference: reconciliation attempt failed for ${reference}: ${error.message}`)
    }
    order = await Order.findOne(filter).populate('event', 'title slug startDate venue coverImage').lean()
    if (!order) {
      return sendTsRestError(res, 404, 'Order not found')
    }
  }

  // Included directly rather than making the client cross-reference
  // /tickets/my-tickets — that endpoint requires a session, which a guest
  // checkout doesn't have, so relying on it here would leave a guest stuck
  // on the "confirming payment" screen forever even after paying.
  const tickets =
    order.status === 'paid' || order.status === 'confirmed'
      ? await Ticket.find({ order: order._id })
          .populate('event', 'title slug startDate venue coverImage')
          .populate('ticketType', 'name')
          .sort({ sequence: 1 })
          .lean()
      : []

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Order fetched',
    body: { ...order, tickets },
  })
})

/**
 * An attendee cancels their own free-event reservation, releasing the
 * place. No payment is involved for free events, so this is a straight
 * cancellation — deletes the ticket outright rather than soft-marking it
 * 'cancelled', since unlike a paid ticket (see requestRefund below)
 * there's no payment or audit trail worth preserving, and leaving a dead
 * row around just meant it kept showing up in My Tickets forever with
 * nothing useful to do with it.
 */
export const cancelReservation = tryCatchWrapper(
  async (req: Request, res: Response) => {
    const { ticketId } = req.params
    const ticketLookup =
      buildTicketLookup(ticketId)

    if (!ticketLookup) {
      return sendTsRestError(
        res,
        404,
        'Reservation not found',
      )
    }

    const ticket = await Ticket.findOne({
      ...ticketLookup,
      pricePaid: 0,
    })

    if (
      !ticket ||
      !ticketBelongsToRequester(req, ticket)
    ) {
      return sendTsRestError(
        res,
        404,
        'Reservation not found',
      )
    }

    if (ticket.status !== 'active') {
      return sendTsRestError(
        res,
        400,
        'This reservation can no longer be cancelled',
      )
    }

    const deletionResult =
      await Ticket.deleteOne({
        _id: ticket._id,
        status: 'active',
      })

    if (deletionResult.deletedCount !== 1) {
      return sendTsRestError(
        res,
        409,
        'This reservation has already been cancelled',
      )
    }

    await Event.updateOne(
      {
        _id: ticket.event,
        reservationsCount: { $gt: 0 },
      },
      {
        $inc: {
          reservationsCount: -1,
        },
      },
    )

    return sendTsRestSuccess<undefined>(
      res,
      200,
      {
        success: true,
        message: 'Reservation cancelled',
      },
    )
  },
)

/**
 * An attendee requests a refund for a paid ticket. Subject to the event's
 * refund policy — except a postponed event, where a refund can always be
 * requested. Only files the request; an admin actually processes the
 * Paystack refund (see admin.controller.ts's approveRefundRequest).
 */
export const requestRefund = tryCatchWrapper(
  async (req: Request, res: Response) => {
  const { ticketId } = req.params
   const { reason } = req.body as {
      reason?: string
    }
  const ticketLookup =
  buildTicketLookup(ticketId)

if (!ticketLookup) {
  return sendTsRestError(
    res,
    404,
    'Ticket not found',
  )
}

  const ticket = await Ticket.findOne({
    ...ticketLookup,
    pricePaid: { $gt: 0 } })

  if (!ticket ||
    !ticketBelongsToRequester(req, ticket)
  ) {
    return sendTsRestError(
      res,
      404,
      'Ticket not found')
  }
  if (ticket.status !== 'active') {
    return sendTsRestError(res, 400, 'This ticket is not eligible for a refund')
  }

  const event = await Event.findById(ticket.event)
  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }

  const eligibility = checkRefundEligibility(event.status, event.refundPolicy, event.startDate)
  if (!eligibility.allowed) {
    return sendTsRestError(res, 400, eligibility.reason ?? 'This ticket is not eligible for a refund')
  }

  const existingRequest = await RefundRequest.findOne({ ticket: ticket._id, status: { $in: ['pending', 'approved'] as Array<'pending' | 'approved'> } })
  if (existingRequest) {
    return sendTsRestError(res, 409, 'A refund request is already in progress for this ticket')
  }

  const refundRequest = await RefundRequest.create({
    ticket: ticket._id,
    order: ticket.order,
    event: ticket.event,
    requestedBy: req.session?.userId,
    reason,
    amount: ticket.pricePaid,
  })

  return sendTsRestSuccess(res, 201, {
    success: true,
    message: 'Refund request submitted for admin review',
    body: refundRequest.toObject(),
  })
})

const GUEST_ACCESS_OTP_TTL_MS = 15 * 60 * 1000 // matches the copy in guestTicketAccessTemplate

/**
 * Sends a short-lived access code to a guest attendee without revealing
 * whether the supplied email has tickets. The OTP is stored only as a
 * bcrypt hash, and requesting a new code invalidates older codes for the
 * same email address.
 */
export const requestGuestTicketAccess =
  tryCatchWrapper(
    async (
      req: Request,
      res: Response,
    ) => {
      const { email } = req.body as {
        email: string
      }

      const normalizedEmail =
        email.trim().toLowerCase()

      const hasAnyTickets =
        await Ticket.exists({
          attendeeEmail:
            normalizedEmail,
        })

      if (hasAnyTickets) {
        const otp = generateOTP()
        const otpHash =
          await bcrypt.hash(otp, 10)

        // Invalidate older codes before creating a new one.
        await GuestAccessCode.deleteMany({
          email: normalizedEmail,
        })

        await GuestAccessCode.create({
          email: normalizedEmail,
          otpHash,
          attempts: 0,
          otpExpiry: new Date(
            Date.now() +
              GUEST_ACCESS_OTP_TTL_MS,
          ),
        })

        EmailService
          .sendGuestTicketAccessEmail({
            email: normalizedEmail,
            otp,
          })
          .catch(error =>
            logger.error(
              {
                err: error,
              },
              `Guest ticket access email failed for ${normalizedEmail}`,
            ),
          )
      }

      return sendTsRestSuccess<undefined>(
        res,
        200,
        {
          success: true,
          message:
            "If that email has any tickets, we've sent a code to access them.",
        },
      )
    },
  )

/**
 * Verifies a guest's emailed OTP, limits failed attempts and atomically
 * consumes a valid code so it cannot be reused. Successful verification
 * stores the normalized email in the guest's session and returns all
 * tickets associated with that address.
 */
export const verifyGuestTicketAccess =
  tryCatchWrapper(
    async (
      req: Request,
      res: Response,
    ) => {
      const {
        email,
        otp,
      } = req.body as {
        email: string
        otp: string
      }

      const normalizedEmail =
        email.trim().toLowerCase()

      const accessCode =
        await GuestAccessCode.findOne({
          email: normalizedEmail,
          otpHash: {
            $exists: true,
          },
        }).sort({
          createdAt: -1,
        })

      if (
        !accessCode ||
        accessCode.otpExpiry.getTime() <
          Date.now() ||
        accessCode.attempts >= 5
      ) {
        return sendTsRestError(
          res,
          400,
          'Invalid or expired code',
        )
      }

      const otpMatches =
        await bcrypt.compare(
          otp,
          accessCode.otpHash,
        )

      if (!otpMatches) {
        const updatedAccessCode =
          await GuestAccessCode
            .findOneAndUpdate(
              {
                _id: accessCode._id,
                attempts: {
                  $lt: 5,
                },
              },
              {
                $inc: {
                  attempts: 1,
                },
              },
              {
                new: true,
              },
            )

        if (
          updatedAccessCode &&
          updatedAccessCode.attempts >= 5
        ) {
          await GuestAccessCode.deleteOne({
            _id:
              updatedAccessCode._id,
          })
        }

        return sendTsRestError(
          res,
          400,
          'Invalid or expired code',
        )
      }

      // Only one simultaneous verification can consume the code.
      const consumeResult =
        await GuestAccessCode.deleteOne({
          _id: accessCode._id,
          attempts: {
            $lt: 5,
          },
        })

      if (consumeResult.deletedCount !== 1) {
        return sendTsRestError(
          res,
          400,
          'Invalid or expired code',
        )
      }

      // Remove any older code records for the same email address.
      await GuestAccessCode.deleteMany({
        email: normalizedEmail,
      })

      req.session.guestEmail =
        normalizedEmail

      const tickets = await Ticket.find({
        attendeeEmail:
          normalizedEmail,
      })
        .populate(
          'event',
          'title slug startDate venue coverImage',
        )
        .populate(
          'ticketType',
          'name',
        )
        .sort({
          createdAt: -1,
        })
        .lean()

      return sendTsRestSuccess(
        res,
        200,
        {
          success: true,
          message: 'Access granted',
          body: tickets,
        },
      )
    },
  )

/**
 * Re-lists a verified guest's tickets without re-sending a code — used
 * when they come back to the tracking page later in the same browser
 * session (req.session.guestEmail persists via the normal session cookie).
 */
export const listGuestTickets = tryCatchWrapper(async (req: Request, res: Response) => {
  if (!req.session.guestEmail) {
    return sendTsRestError(res, 401, 'Verify your email to view your tickets')
  }

  const tickets = await Ticket.find({ attendeeEmail: req.session.guestEmail })
    .populate('event', 'title slug startDate venue coverImage')
    .populate('ticketType', 'name')
    .sort({ createdAt: -1 })
    .lean()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Tickets fetched',
    body: tickets,
  })
})

export const myTickets = tryCatchWrapper(async (req: Request, res: Response) => {
  const tickets = await Ticket.find({ attendee: req.session.userId })
    .populate('event', 'title slug startDate venue coverImage')
    .populate('ticketType', 'name')
    .sort({ createdAt: -1 })
    .lean()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Tickets fetched',
    body: tickets,
  })
})

export const getTicketQrCode =
  tryCatchWrapper(
    async (
      req: Request,
      res: Response,
    ) => {
      const { ticketId } = req.params
      const ticketLookup =
        buildTicketLookup(ticketId)

      if (!ticketLookup) {
        return sendTsRestError(
          res,
          404,
          'Ticket not found',
        )
      }

      const ticket =
        await Ticket.findOne(
          ticketLookup,
        ).lean()

      if (
        !ticket ||
        !ticketBelongsToRequester(
          req,
          ticket,
        )
      ) {
        return sendTsRestError(
          res,
          404,
          'Ticket not found',
        )
      }

      const qrCodeDataUrl =
        await generateQrCodeDataUrl(
          ticket.code,
        )

      return sendTsRestSuccess(
        res,
        200,
        {
          success: true,
          message: 'QR code generated',
          body: {
            qrCodeDataUrl,
          },
        },
      )
    },
  )

/**
 * Serves the QR as an actual image response (Content-Type: image/png),
 * not JSON — for use in <img src="..."> tags, specifically the
 * confirmation email. That's the one place a plain browser session check
 * can't work: an email client's image loader is just an anonymous GET, no
 * cookies attached, so getTicketQrCode above always 404s for it
 * (ticketBelongsToRequester has nothing to check against). Keyed by `code`
 * instead of `_id` on purpose — `code` is itself an unguessable secret,
 * so knowing it is already equivalent proof of ownership, the same trust
 * model getOrderByReference above already uses for the same reason.
 */
export const getTicketQrCodeImage = tryCatchWrapper(async (req: Request, res: Response) => {
  const { code } = req.params

  const ticket = await Ticket.findOne({ code }).select('code').lean()
  if (!ticket) {
    return res.status(404).end()
  }

  const qrCodeBuffer = await generateQrCodeBuffer(ticket.code)

  res.setHeader('Content-Type', 'image/png')
  // A ticket's code never changes once issued, so this image is
  // permanently cacheable — email clients and proxies fetching it
  // repeatedly (some re-fetch on every open) don't need to hit this
  // endpoint more than once per client.
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  return res.send(qrCodeBuffer)
})