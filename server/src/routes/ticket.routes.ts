import { Router } from 'express'
import {
  cancelReservation,
  getOrderByReference,
  getTicketQrCode,
  getTicketQrCodeImage,
  initializeCheckout,
  listGuestTickets,
  requestGuestTicketAccess,
  requestRefund,
  rsvpFreeEvent,
  verifyGuestTicketAccess,
} from '../controllers/ticket.controller.js'
import {
  guestTicketAccessRequestSchema,
  guestTicketAccessVerifySchema,
  refundRequestSchema,
  referenceCheckoutSchema,
  referenceRsvpSchema,
} from '../lib/schemaValidation.js'
import { validateFormData } from '../middlewares/schema.middleware.js'
import { customRateLimiter } from '../middlewares/rateLimit.middleware.js'

const router = Router()

// GET /my-tickets is handled by ticket-history.routes.ts (also mounted at
// /api/v1/tickets) — that implementation is paginated and view-filterable
// (upcoming/past/all); this file used to have its own basic version too,
// but it was fully shadowed by ticket-history's route being mounted first,
// so it's been removed rather than left as dead, unreachable code.

// Adapters for sever-a's (reference frontend client) exact request/response
// contract — same underlying logic as checkout.routes.ts (/events/:eventId/checkout)
// and reservation.routes.ts (/events/:eventId/reservations), just reshaped.
// Kept alongside those, not replacing them, so neither client breaks.
router.post('/checkout/:eventId', customRateLimiter(10), validateFormData(referenceCheckoutSchema), initializeCheckout)
router.post('/rsvp/:eventId', customRateLimiter(10), validateFormData(referenceRsvpSchema), rsvpFreeEvent)

// "Track my ticket by email" — for a guest who wants to view/manage a
// ticket later, whether or not the confirmation email actually arrived.
router.post('/guest-access/request', customRateLimiter(5), validateFormData(guestTicketAccessRequestSchema), requestGuestTicketAccess)
router.post('/guest-access/verify', customRateLimiter(10), validateFormData(guestTicketAccessVerifySchema), verifyGuestTicketAccess)
router.get('/guest-access/tickets', listGuestTickets) // controller itself checks req.session.guestEmail

// Polled by /checkout/confirmation on the client after the Paystack redirect —
// keep this above '/:ticketId/qrcode' so 'orders' isn't swallowed as a ticketId.
// No verifySession: the reference is itself an unguessable capability (see
// getOrderByReference), same trust model as a payment receipt link.
router.get('/orders/:reference', getOrderByReference)

// Fully public, no session check — this is what the confirmation email's
// <img src> hits (see getTicketQrCodeImage's own comment for why it can't
// share getTicketQrCode below). Keep above '/:ticketId/qrcode' for the
// same reason '/orders/:reference' sits above it — a literal path segment
// should never be swallowed by a param route.
router.get('/qrcode-image/:code', getTicketQrCodeImage)

// No verifySession on these three — ownership is checked inside each
// controller via ticketBelongsToRequester, which accepts either a logged-in
// session or a verified guestEmail session. An anonymous request with
// neither just gets a 404, same as trying to access someone else's ticket.
router.get('/:ticketId/qrcode', getTicketQrCode)
router.delete('/:ticketId/reservation', cancelReservation)
router.post(
  '/:ticketId/refund-request',
  customRateLimiter(5),
  validateFormData(refundRequestSchema),
  requestRefund,
)

export default router
