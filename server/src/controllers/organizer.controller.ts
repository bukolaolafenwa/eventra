import { Request, Response } from 'express'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import { sanitizeUser } from '../lib/utils.js'
import User, { IOrganizerProfile } from '../models/user.js'

/**
 * Create or update the caller's organizer profile (org info + bank
 * details). This is the wizard's "save as you go" endpoint — each step
 * (About your organization, Bank account) and "Save & exit" all call this
 * with just the fields that step collected, so it only ever merges over
 * the existing profile rather than replacing it.
 *
 * Submitting new bank details on an already-*approved* profile resets it
 * to 'pending' — an admin must re-verify before payouts resume. Editing
 * anything else, or editing while still in 'draft' (i.e. the wizard isn't
 * submitted yet), never changes approvalStatus — that only moves forward
 * via submitOrganizerProfileForReview below.
 */
export const upsertOrganizerProfile = tryCatchWrapper(async (req: Request, res: Response) => {
  const user = await User.findById(req.session.userId)
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  const existing = user.organizerProfile
  const bankDetailsChanged =
    !!existing &&
    ((req.body.accountNumber && req.body.accountNumber !== existing.accountNumber) ||
      (req.body.bankCode && req.body.bankCode !== existing.bankCode))

  const nextApprovalStatus: IOrganizerProfile['approvalStatus'] =
    existing?.approvalStatus === 'approved' && bankDetailsChanged ? 'pending' : (existing?.approvalStatus ?? 'draft')

  const bankName = req.body.bankName ?? existing?.bankName
  const bankCode = req.body.bankCode ?? existing?.bankCode
  const accountNumber = req.body.accountNumber ?? existing?.accountNumber
  const accountName = req.body.accountName ?? existing?.accountName

  user.organizerProfile = {
    businessName: req.body.businessName ?? existing?.businessName,
    category: req.body.category ?? existing?.category,
    city: req.body.city ?? existing?.city,
    contactPhone: req.body.contactPhone ?? existing?.contactPhone,
    publicEmail: req.body.publicEmail ?? existing?.publicEmail,
    bio: req.body.bio ?? existing?.bio,
    bankName,
    bankCode,
    accountNumber,
    accountName,
    // "Ready" just means a fully resolved bank account is on file — this
    // drives the dashboard's "Finish setting up your account" banner
    // (see organizer/overview) independently of admin approval, since a
    // free-events-only organizer can be approved without ever adding one.
    isPayoutReady: !!(bankName && bankCode && accountNumber && accountName),
    approvalStatus: nextApprovalStatus,
    paystackRecipientCode: existing?.paystackRecipientCode,
    agreedToTerms: req.body.agreedToTerms ?? existing?.agreedToTerms ?? false,
    submittedAt: existing?.submittedAt,
  }

  await user.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Organizer profile updated',
    body: sanitizeUser(user.toObject()),
  })
})

const REQUIRED_FOR_SUBMISSION: { field: keyof IOrganizerProfile; label: string }[] = [
  { field: 'businessName', label: 'Organization name' },
  { field: 'category', label: 'Category' },
  { field: 'city', label: 'City' },
  { field: 'contactPhone', label: 'Contact phone' },
  { field: 'publicEmail', label: 'Public email' },
  { field: 'bio', label: 'Short bio' },
]

/**
 * Step 3 of the wizard ("Review & submit"). Bank details are deliberately
 * NOT required here — the Figma lets organizers skip that step and add it
 * later from settings; only free events need it to go live, per
 * event.controller.ts's paid-event gate.
 */
export const submitOrganizerProfileForReview = tryCatchWrapper(async (req: Request, res: Response) => {
  const user = await User.findById(req.session.userId)
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  const profile = user.organizerProfile
  const missing = REQUIRED_FOR_SUBMISSION.filter(({ field }) => !profile?.[field]).map(({ label }) => label)
  if (missing.length > 0) {
    return sendTsRestError(res, 400, `Finish these before submitting: ${missing.join(', ')}`)
  }

  if (!req.body.agreedToTerms && !profile!.agreedToTerms) {
    return sendTsRestError(res, 400, 'You must agree to the Organizer Terms and Payout Policy')
  }

  user.role = 'organizer'
  user.organizerProfile!.agreedToTerms = true
  user.organizerProfile!.approvalStatus = 'pending'
  user.organizerProfile!.submittedAt = new Date()
  await user.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Submitted for review',
    body: sanitizeUser(user.toObject()),
  })
})

export const getOrganizerProfile = tryCatchWrapper(async (req: Request, res: Response) => {
  const user = await User.findById(req.session.userId).lean()
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Organizer profile fetched',
    body: user.organizerProfile ?? null,
  })
})

// TODO: reintroduce listBanks and resolveBankAccount once Paystack is
// wired back up. listBanks cached PaystackService.listBanks() in-process
// for a day (the bank list is effectively static). resolveBankAccount
// confirmed the account holder's name for the "Where should we send your
// money?" step via PaystackService.resolveAccount({ accountNumber, bankCode }),
// so the form could fill Account Holder Name from a verified source
// rather than letting the organizer type it themselves.

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Pending',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  postponed: 'Postponed',
  sold_out: 'Sold out',
  live: 'Live',
  past: 'Past',
}

/**
 * Powers the dashboard's Overview page: the 4 stat cards (tickets sold,
 * revenue, live events, payout due) and the "Recent events" table.
 *
 * TODO: once Order is wired up, restore the payout aggregation
 * (payoutDue, nextPayoutInDays) and the 30-day-vs-previous-30-day percent
 * change on ticketsSold/revenue. For now those fields are stubbed so the
 * response shape doesn't break the frontend.
 */


// TODO: reintroduce listOrganizerPayouts once Order is implemented.
// It previously listed paid/partially_refunded orders for the
// organizer's events with pagination and a payoutStatus breakdown.