import { OAuth2Client } from 'google-auth-library'

import { env } from '../config/keys.js'
import { ErrorResponse } from '../middlewares/error.middleware.js'

export interface VerifiedGoogleUser {
  googleId: string
  email: string
  fullname: string
  avatarUrl?: string
}

export class GoogleAuthService {
  private clientInstance?: OAuth2Client

  private get client(): OAuth2Client {
    if (!this.clientInstance) {
      this.clientInstance = new OAuth2Client(
        env.GOOGLE_CLIENT_ID
      )
    }

    return this.clientInstance
  }

  async verifyCredential(
    credential: string
  ): Promise<VerifiedGoogleUser> {
    const normalizedCredential = credential.trim()

    if (!normalizedCredential) {
      throw new ErrorResponse(
        'Google credential is required',
        400
      )
    }

    try {
      const ticket = await this.client.verifyIdToken({
        idToken: normalizedCredential,
        audience: env.GOOGLE_CLIENT_ID,
      })

      const payload = ticket.getPayload()

      if (
        !payload?.sub ||
        !payload.email ||
        payload.email_verified !== true
      ) {
        throw new ErrorResponse(
          'Google account could not be verified',
          401
        )
      }

      const fullname =
        payload.name?.trim() ||
        payload.email.split('@')[0]

      return {
        googleId: payload.sub,
        email: payload.email.trim().toLowerCase(),
        fullname,
        avatarUrl: payload.picture,
      }
    } catch (error: unknown) {
      if (error instanceof ErrorResponse) {
        throw error
      }

      throw new ErrorResponse(
        'Invalid or expired Google credential',
        401
      )
    }
  }
}

export const googleAuthService =
  new GoogleAuthService()