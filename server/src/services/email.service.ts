import sendEmail from '../email/send-email.js'
import { verifyAccountTemplate, resetPasswordTemplate } from '../lib/emailTemplates.js'
import EmailQueue from '../models/emailQueue.js'
// import { IUser } from '../models/user.js'

export class EmailService {
  static async sendVerifyAccountEmail({
    user,
    otp,
    link,
  }: {
    user: any
    otp: string
    link: string
  }): Promise<{ success: boolean; queued: boolean }> {
    const htmlBody = verifyAccountTemplate(user.fullname, otp, link)
    const result = await sendEmail({
      email: user.email,
      subject: 'Verify your account - EventPulse',
      message: htmlBody,
    })
    if (result.success) {
      return { success: true, queued: false }
    }

    // Queue for retry via cron job
    await EmailQueue.create({
      to: user.email,
      subject: 'Verify your account - EventPulse',
      html: htmlBody,
      priority: 'high',
      status: 'queued',
      retryCount: 0,
      nextRetryAt: new Date(Date.now() + 5 * 60 * 1000), // First retry in 5 minutes
    })
    return { success: false, queued: true }
  }

  static async sendPasswordResetEmail({
    user,
    otp,
  }: {
    user: any
    otp: string
  }): Promise<{ success: boolean; queued: boolean }> {
    const htmlBody = resetPasswordTemplate(user.fullname, otp)
    const result = await sendEmail({
      email: user.email,
      subject: 'Reset your password - Eventra',
      message: htmlBody,
    })
    if (result.success) {
      return { success: true, queued: false }
    }

    await EmailQueue.create({
      to: user.email,
      subject: 'Reset your password - Eventra',
      html: htmlBody,
      priority: 'high',
      status: 'queued',
      retryCount: 0,
      nextRetryAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    return { success: false, queued: true }
  }
}

export const emailService = new EmailService()