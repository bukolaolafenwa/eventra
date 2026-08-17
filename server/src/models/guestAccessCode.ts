import mongoose, {
  Document,
  Schema,
} from 'mongoose'

/**
 * Backs the "track my ticket by email" flow for people who checked out or
 * RSVP'd as a guest and want to view or manage their tickets later.
 *
 * A code sent to the attendee's email proves inbox ownership. The OTP is
 * stored as a bcrypt hash, expires after fifteen minutes and permits only
 * a limited number of failed verification attempts.
 *
 * After successful verification, the controller stores the normalized
 * email in req.session.guestEmail. Ticket ownership checks then treat that
 * verified email similarly to an authenticated attendee identity.
 */
export interface IGuestAccessCode
  extends Document {
  email: string
  otpHash: string
  otpExpiry: Date
  attempts: number
  createdAt: Date
}

const GuestAccessCodeSchema =
  new Schema<IGuestAccessCode>({
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    otpHash: {
      type: String,
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    otpExpiry: {
      type: Date,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  })

GuestAccessCodeSchema.index({
  email: 1,
})

// MongoDB automatically removes expired guest access codes.
GuestAccessCodeSchema.index(
  {
    otpExpiry: 1,
  },
  {
    expireAfterSeconds: 0,
  },
)

const GuestAccessCode =
  mongoose.models.GuestAccessCode ||
  mongoose.model<IGuestAccessCode>(
    'GuestAccessCode',
    GuestAccessCodeSchema,
    'guestAccessCodes',
  )

export default GuestAccessCode