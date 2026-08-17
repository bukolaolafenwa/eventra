import { Request, Response } from 'express'
import { isAuthorizedCronCall } from '../lib/cronAuth.js'
import { expirePromotions } from '../jobs/promotionExpiryCron.js'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'

/**
 * Reserved endpoint for the future organizer-payout scheduler.
 *
 * Automated transfers remain unavailable until Eventra has persistent
 * payout records, Paystack transfer recipients, unique transfer references,
 * webhook reconciliation and safe retry handling.
 */
export const checkPayoutCron = tryCatchWrapper(async (req: Request, res: Response) => {
  if (!isAuthorizedCronCall(req)) {
    return sendTsRestError(res, 401, 'Unauthorized: invalid or missing CRON_SECRET')
  }

  return sendTsRestError(res, 501, 'Automated organizer payouts are not available yet')
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