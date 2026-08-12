import { Request, Response } from 'express'
import { isAuthorizedCronCall } from '../lib/cronAuth.js'
import { expirePromotions } from '../jobs/promotionExpiryCron.js'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'

/**
 * STILL STUBBED — deliberately not wired to jobs/payoutCron.ts's
 * processDuePayouts(). That function calls a paystackService method that
 * doesn't exist (initiateTransfer), reads Order fields that don't exist
 * on the current model (payoutStatus, organizerEarnings), and depends on
 * organizerProfile.paystackRecipientCode — which nothing in this codebase
 * currently populates (see admin.controller.ts's approveOrganizer comment:
 * transfer-recipient creation was removed and never replaced). Wiring this
 * up as-is would throw on every cron invocation. This needs a real design
 * decision — how/when is a Paystack transfer recipient actually created
 * for an organizer? — before it's safe to re-enable. The organizer payout
 * *amount* is already visible read-only via listOrganizerPayouts in
 * organizer.controller.ts; this cron is specifically about automating the
 * actual money transfer.
 */
export const checkPayoutCron = tryCatchWrapper(async (req: Request, res: Response) => {
  if (!isAuthorizedCronCall(req)) {
    return sendTsRestError(res, 401, 'Unauthorized: invalid or missing CRON_SECRET')
  }

  return sendTsRestError(res, 501, 'Automated payout transfers are not wired up yet — see the comment above this handler')
})

export const checkPromotionExpiryCron = tryCatchWrapper(async (req: Request, res: Response) => {
  if (!isAuthorizedCronCall(req)) {
    return sendTsRestError(res, 401, 'Unauthorized: invalid or missing CRON_SECRET')
  }

  const result = await expirePromotions()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Promotion expiry cron job completed',
    body: result,
  })
})