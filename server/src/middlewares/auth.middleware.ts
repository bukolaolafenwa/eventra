import { Request, Response, NextFunction } from 'express'
import { sendTsRestError } from '../lib/responseHandler.js'

/**
 * Guards routes that require a logged-in user.
 * Checks for `req.session.userId`, set during login/register.
 */
export const verifySession = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.session?.userId) {
    sendTsRestError(res, 401, 'You must be logged in to perform this action.')
    return
  }
  next()
}

/**
 * Guards routes that require a specific role (e.g. 'organizer').
 * Must run AFTER verifySession, since it relies on req.session.role.
 *
 * Usage:
 *   router.post('/categories', verifySession, requireRole('organizer'), controller)
 */
export const requireRole = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.session?.role

    if (!role || !allowedRoles.includes(role)) {
      sendTsRestError(res, 403, 'You do not have permission to perform this action.')
      return
    }
    next()
  }
}

/*
 * WHAT THIS FILE DOES:
 * Two small guards that sit in front of protected routes:
 *  - verifySession: confirms someone is logged in at all (401 if not).
 *  - requireRole: confirms the logged-in user has the right role for this
 *    specific action (403 if not) — e.g. only organizers can manage categories.
 *
 * WHY IT MATTERS FOR EVENTRA:
 * Categories are structural data ("Music", "Tech", "Sports", etc.) that
 * organize the whole platform. Letting any random attendee create or delete
 * one would break browsing for everyone. Reads (getCategories/getCategory)
 * stay public since attendees need to filter events by category — only
 * writes (create/update/delete) are locked to organizers.
 *
 * NOTE: This file didn't exist in the repo yet — it's a shared dependency
 * the Auth teammate will likely also need. Built to match the session shape
 * from the Auth Controller guide (req.session.userId, req.session.role).
 * If they've since built their own verifySession, swap it in — this one
 * follows the same contract, so it should be a clean 1:1 replacement.
 */