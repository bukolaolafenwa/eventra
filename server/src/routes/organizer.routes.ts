import { Router } from 'express'
import { verifySession } from '../middlewares/auth.middleware.js'

const router = Router()

router.use(verifySession)

export default router