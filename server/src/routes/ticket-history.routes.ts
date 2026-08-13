import { Router } from 'express'

import { listMyTickets } from '../controllers/ticket-history.controller.js'
import { verifySession } from '../middlewares/auth.middleware.js'

const router = Router()

/**
 * @route   GET /api/v1/tickets/my-tickets
 * @desc    Retrieve the authenticated user's ticket history
 * @access  Authenticated user
 */
router.get(
  '/my-tickets',
  verifySession,
  listMyTickets,
)

export default router