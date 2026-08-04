import { Router } from 'express'
import {
  createOrganizer,
  getOrganizerProfile,
  updateOrganizerProfile,
  submitForApproval,
} from '../controllers/organizer.controller.js'
import { verifySession } from '../middlewares/auth.middleware.js'

const router = Router()

// Protect all organizer routes with session authentication
router.use(verifySession)

router.post('/', createOrganizer)
router.get('/me', getOrganizerProfile)
router.patch('/me', updateOrganizerProfile)
router.post('/submit-approval', submitForApproval)

export default router