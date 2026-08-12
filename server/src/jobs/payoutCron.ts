import logger from '../config/logger.js'

/**
 * DISABLED — not called from anywhere (see the comment on checkPayoutCron
 * in cron.controller.ts for the full explanation). The previous version of
 * this function called a paystackService method that doesn't exist
 * (initiateTransfer), read Order fields that don't exist on the current
 * model (payoutStatus, organizerEarnings), and depended on
 * organizerProfile.paystackRecipientCode, which nothing in this codebase
 * currently populates — it would have thrown on every invocation.
 *
 * Rewritten as a safe no-op (rather than deleted outright) so the file
 * still compiles cleanly under tsc and so the intended shape/name is here
 * for whoever picks this up once there's an actual Paystack
 * transfer-recipient creation flow to call into. Read-only visibility into
 * what's owed to each organizer already exists — see listOrganizerPayouts
 * in organizer.controller.ts — this is specifically about automating the
 * real money transfer, which needs a deliberate design decision, not a
 * guess.
 */
export const processDuePayouts = async (): Promise<{ processed: number; initiated: number; skipped: number }> => {
  logger.warn('Payout cron: processDuePayouts is disabled pending a real Paystack transfer-recipient flow — no-op')
  return { processed: 0, initiated: 0, skipped: 0 }
}
