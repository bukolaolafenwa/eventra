import { randomUUID } from 'crypto'
import { Request, Response } from 'express'
import { env } from '../config/keys.js'
import { getPromotionPackage, PROMOTION_PACKAGES } from '../config/promotionPackages.js'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import Event from '../models/event.js'
import User from '../models/user.js'

const NAIRA_TO_KOBO = 100

export const listPromotionPackages = tryCatchWrapper(async (req: Request, res: Response) => {
  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Promotion packages fetched',
    body: PROMOTION_PACKAGES,
  })
})

/**
 * Organizer requests to promote their (already-approved) event. Payment is
 * collected first; an admin still has to approve the promotion afterwards
 * before it actually goes live (see admin.controller.ts).
 *
 * TODO(paystack): this depends on PaystackService.initializeTransaction(),
 * owned by Person B (Tickets, Checkout & Payments). Swap the stub below for
 * the real import + call once that service is merged in. Left the event
 * validation, reference generation, and event.promotion write-up intact
 * since none of that depends on their code.
 */
export const requestPromotion = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const { packageId } = req.body as { packageId: string }

  const pkg = getPromotionPackage(packageId)
  if (!pkg) {
    return sendTsRestError(res, 400, 'Unknown promotion package')
  }

  const event = await Event.findOne({ _id: id, organizer: req.session.userId })
  if (!event) {
    return sendTsRestError(res, 404, 'Event not found')
  }
  if (event.status !== 'approved') {
    return sendTsRestError(res, 400, 'Only a live approved event can be promoted')
  }
  if (event.promotion && event.promotion.status === 'pending') {
    return sendTsRestError(res, 409, 'A promotion request is already pending for this event')
  }

  const organizer = await User.findById(req.session.userId)
  if (!organizer) {
    return sendTsRestError(res, 404, 'User not found')
  }

  const reference = `PROMO-${event._id.toString().slice(-6)}-${randomUUID()}`

  // --- TODO(paystack): replace this block once PaystackService is available ---
  return sendTsRestError(res, 501, 'Promotion checkout is not wired up yet (pending Paystack integration)')
  // try {
  //   const paystackTx = await PaystackService.initializeTransaction({
  //     email: organizer.email,
  //     amountKobo: pkg.priceNaira * NAIRA_TO_KOBO,
  //     reference,
  //     callbackUrl: `${env.CLIENT_URL}/organizer/promotions/callback`,
  //     metadata: { eventId: event._id.toString(), packageId: pkg.id },
  //   })
  //
  //   event.promotion = { package: pkg.id, status: 'pending', paystackReference: reference }
  //   await event.save()
  //
  //   return sendTsRestSuccess(res, 201, {
  //     success: true,
  //     message: 'Promotion checkout initialized',
  //     body: { authorizationUrl: paystackTx.authorizationUrl, reference },
  //   })
  // } catch (error: any) {
  //   return sendTsRestError(res, 502, error.message || 'Could not start payment with Paystack')
  // }
  // --- end TODO ---
})