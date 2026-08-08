import { Request, Response } from 'express'
import { env } from '../config/keys.js'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import { generateOTP, sanitizeUser } from '../lib/utils.js'
import User from '../models/user.js'
import { EmailService } from '../services/email.service.js'

const OTP_TTL_MS = 15 * 60 * 1000 // 15 minutes, matches the email copy
const MAX_OTP_ATTEMPTS = 5 // Maximum OTP verification attempts before requiring a new OTP
const MAX_PASSWORD_RESET_ATTEMPTS = 5 // Maximum password reset attempts before requiring a new reset code


function verifyEmailLink(email: string, role: 'attendee' | 'organizer') {
  const path = role === 'organizer' ? '/organizer/auth/verify-email' : '/auth/verify-email'
  return `${env.CLIENT_URL}${path}?email=${encodeURIComponent(email)}`
}


export const register = tryCatchWrapper(async (req: Request, res: Response) => {
  const { fullname, email, password, phone, role } = req.body
  const resolvedRole = role === 'organizer' ? 'organizer' : 'attendee'

  const existingUser = await User.findOne({ email }).lean()
  if (existingUser) {
    return sendTsRestError(res, 409, 'An account with this email already exists')
  }

  const otp = generateOTP()

  const user = await User.create({
    fullname,
    email,
    password,
    phone,
    role: resolvedRole,
    emailVerificationOTP: otp,
    emailVerificationOTPExpiry: new Date(Date.now() + OTP_TTL_MS),
  })

  await EmailService.sendVerifyAccountEmail({
    user,
    otp,
    link: verifyEmailLink(email, resolvedRole),
  })

  return sendTsRestSuccess(res, 201, {
    success: true,
    message: 'Account created. Check your email for a verification code.',
    body: { email: user.email },
  })
})

export const verifyEmail = tryCatchWrapper(async (req: Request, res: Response) => {
  const { email, otp } = req.body

  const user = await User.findOne({ email }).select(
    '+emailVerificationOTP +emailVerificationOTPExpiry +emailVerificationAttempts'
  )

  if (!user) {
    return sendTsRestError(res, 404, 'No account found with this email')
  }

  if (user.isVerified) {
    return sendTsRestError(res, 400, 'This account is already verified')
  }

  if (!user.emailVerificationOTP || !user.emailVerificationOTPExpiry) {
    return sendTsRestError(
      res,
      400,
      'No verification code was requested for this account'
    )
  }

  if (user.emailVerificationOTPExpiry.getTime() < Date.now()) {
    return sendTsRestError(
      res,
      400,
      'Verification code has expired. Please request a new one'
    )
  }

  // Prevent further verification attempts after maximum retries
  if (user.emailVerificationAttempts >= MAX_OTP_ATTEMPTS) {
    return sendTsRestError(
      res,
      429,
      'Maximum verification attempts reached. Please request a new verification code.'
    )
  }

  // Wrong OTP
  if (user.emailVerificationOTP !== otp) {
    user.emailVerificationAttempts += 1
    await user.save()

    const remainingAttempts =
      MAX_OTP_ATTEMPTS - user.emailVerificationAttempts

    if (remainingAttempts > 0) {
      return sendTsRestError(
        res,
        400,
        `Invalid verification code. ${remainingAttempts} attempt(s) remaining.`
      )
    }

    return sendTsRestError(
      res,
      429,
      'Maximum verification attempts reached. Please request a new verification code.'
    )
  }

  // Verification successful
  user.isVerified = true
  user.emailVerificationOTP = undefined
  user.emailVerificationOTPExpiry = undefined
  user.emailVerificationAttempts = 0

  await user.save()

  req.session.userId = user._id.toString()
  req.session.role = user.role

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Email verified successfully',
    body: sanitizeUser(user.toObject()),
  })
})

export const resendOtp = tryCatchWrapper(async (req: Request, res: Response) => {
  const { email } = req.body

  const user = await User.findOne({ email }).select('+emailVerificationAttempts')

  if (!user) {
    return sendTsRestError(res, 404, 'No account found with this email')
  }

  if (user.isVerified) {
    return sendTsRestError(res, 400, 'This account is already verified')
  }

  const otp = generateOTP()

  user.emailVerificationOTP = otp
  user.emailVerificationOTPExpiry = new Date(Date.now() + OTP_TTL_MS)

  // Reset OTP verification attempts
  user.emailVerificationAttempts = 0

  await user.save()

  await EmailService.sendVerifyAccountEmail({
    user,
    otp,
    link: verifyEmailLink(email, user.role),
  })

  return sendTsRestSuccess<undefined>(res, 200, {
    success: true,
    message: 'A new verification code has been sent to your email',
  })
})

export const login = tryCatchWrapper(async (req: Request, res: Response) => {
  const { email, password } = req.body

 const user = await User.findOne({ email }).select(
  '+password +failedLoginAttempts +lockUntil'
)
  if (!user) {
    return sendTsRestError(res, 401, 'Invalid email or password')
  }

  // Check if account is currently locked
if (user.lockUntil && user.lockUntil > new Date()) {
  const minutesLeft = Math.ceil(
    (user.lockUntil.getTime() - Date.now()) / (1000 * 60)
  )

  return sendTsRestError(
    res,
    423,
    `Account locked due to multiple failed login attempts. Try again in ${minutesLeft} minute(s).`
  )
}

  if (user.isSuspended) {
    return sendTsRestError(res, 403, 'This account has been suspended. Contact support for help')
  }

  const passwordMatches = await user.matchPassword(password)

if (!passwordMatches) {
  user.failedLoginAttempts += 1

  const MAX_LOGIN_ATTEMPTS = 5
  const LOCK_DURATION = 15 * 60 * 1000 // 15 minutes

  if (user.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
    user.lockUntil = new Date(Date.now() + LOCK_DURATION)
  }

  await user.save()

  const remainingAttempts = Math.max(
    0,
    MAX_LOGIN_ATTEMPTS - user.failedLoginAttempts
  )

  if (remainingAttempts > 0) {
    return sendTsRestError(
      res,
      401,
      `Invalid email or password. ${remainingAttempts} login attempt(s) remaining.`
    )
  }

  return sendTsRestError(
    res,
    423,
    'Account locked due to too many failed login attempts. Please try again in 15 minutes.'
  )
}

  if (!user.isVerified) {
    return sendTsRestError(res, 403, 'Please verify your email before logging in')
  }

  // Reset login attempts
user.failedLoginAttempts = 0
user.lockUntil = undefined

// Update last login
user.lastLogin = new Date()

await user.save()

  req.session.userId = user._id.toString()
  req.session.role = user.role

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Logged in successfully',
    body: sanitizeUser(user.toObject()),
  })
})

export const logout = tryCatchWrapper(async (req: Request, res: Response) => {
  req.session.destroy(err => {
    if (err) {
      return sendTsRestError(res, 500, 'Could not log out, please try again')
    }
    res.clearCookie('_evtSessionId')
    return sendTsRestSuccess<undefined>(res, 200, {
      success: true,
      message: 'Logged out successfully',
    })
  })
})

export const me = tryCatchWrapper(async (req: Request, res: Response) => {
  const user = await User.findById(req.session.userId).lean()
  if (!user) {
    return sendTsRestError(res, 404, 'User not found')
  }

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Current user fetched',
    body: sanitizeUser(user),
  })
})

export const forgotPassword = tryCatchWrapper(async (req: Request, res: Response) => {
  const { email } = req.body

  const user = await User.findOne({ email }).select('+passwordResetAttempts')

  // Prevent email enumeration
  const genericResponse = () =>
    sendTsRestSuccess<undefined>(res, 200, {
      success: true,
      message: 'If an account exists for this email, a reset code has been sent.',
    })

  if (!user) {
    return genericResponse()
  }

  const otp = generateOTP()

  user.passwordResetOTP = otp
  user.passwordResetOTPExpiry = new Date(Date.now() + OTP_TTL_MS)

  // Reset attempts whenever a new OTP is generated
  user.passwordResetAttempts = 0

  await user.save()

  await EmailService.sendPasswordResetEmail({
    user,
    otp,
  })

  return genericResponse()
})

export const resetPassword = tryCatchWrapper(async (req: Request, res: Response) => {
  const { email, otp, newPassword } = req.body

  const user = await User.findOne({ email }).select(
    '+passwordResetOTP +passwordResetOTPExpiry +passwordResetAttempts'
  )

  if (!user) {
    return sendTsRestError(res, 404, 'No account found with this email')
  }

  if (!user.passwordResetOTP || !user.passwordResetOTPExpiry) {
    return sendTsRestError(
      res,
      400,
      'No password reset was requested for this account'
    )
  }

  if (user.passwordResetOTPExpiry.getTime() < Date.now()) {
    return sendTsRestError(
      res,
      400,
      'Reset code has expired. Please request a new one.'
    )
  }

  // Maximum attempts reached
  if (user.passwordResetAttempts >= MAX_PASSWORD_RESET_ATTEMPTS) {
    return sendTsRestError(
      res,
      429,
      'Maximum password reset attempts reached. Please request a new reset code.'
    )
  }

  // Wrong OTP
  if (user.passwordResetOTP !== otp) {
    user.passwordResetAttempts += 1

    await user.save()

    const remainingAttempts =
      MAX_PASSWORD_RESET_ATTEMPTS - user.passwordResetAttempts

    if (remainingAttempts > 0) {
      return sendTsRestError(
        res,
        400,
        `Invalid reset code. ${remainingAttempts} attempt(s) remaining.`
      )
    }

    return sendTsRestError(
      res,
      429,
      'Maximum password reset attempts reached. Please request a new reset code.'
    )
  }

  // Success
  user.password = newPassword

  user.passwordResetOTP = undefined
  user.passwordResetOTPExpiry = undefined
  user.passwordResetAttempts = 0

  await user.save()

  return sendTsRestSuccess<undefined>(res, 200, {
    success: true,
    message: 'Password reset successfully. You can now log in.',
  })
})