import bcrypt from 'bcrypt'
import mongoose, { Document, Schema } from 'mongoose'

export interface IOrganizerProfile {
  businessName?: string
  category?: string
  city?: string
  contactPhone?: string
  publicEmail?: string
  bio?: string
  bankName?: string
  bankCode?: string
  accountNumber?: string
  accountName?: string
  isPayoutReady: boolean
  // 'draft' — onboarding wizard in progress, not yet submitted (not shown
  // to admins). 'pending' — submitted, awaiting admin review. Set by
  // submitOrganizerProfileForReview, not by every profile edit.
  approvalStatus: 'draft' | 'pending' | 'approved' | 'rejected'
  paystackRecipientCode?: string
  agreedToTerms?: boolean
  submittedAt?: Date
}

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId

  fullname: string
  email: string
  password: string
  phone: string
  city?: string
  avatarUrl?: string
  avatarPublicId?: string
  
  
  role: 'attendee' | 'organizer' | 'admin'

  isVerified: boolean
  isSuspended: boolean

  emailVerificationOTP?: string
  emailVerificationOTPExpiry?: Date
  emailVerificationAttempts: number

  passwordResetOTP?: string
  passwordResetOTPExpiry?: Date
  passwordResetAttempts: number

  failedLoginAttempts: number
  lockUntil?: Date
  lastLogin?: Date

  organizerProfile?: IOrganizerProfile

  savedEvents: mongoose.Types.ObjectId[]

  createdAt: Date
  updatedAt: Date

  matchPassword(candidate: string): Promise<boolean>
  isLocked(): boolean
  resetLoginAttempts(): void
}

const OrganizerProfileSchema = new Schema<IOrganizerProfile>(
  {
    businessName: { type: String, trim: true },
    category: { type: String, trim: true },
    city: { type: String, trim: true },
    contactPhone: { type: String, trim: true },
    publicEmail: { type: String, trim: true, lowercase: true },
    bio: { type: String, trim: true, maxlength: 280 },
    bankName: { type: String, trim: true },
    bankCode: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    accountName: { type: String, trim: true },
    isPayoutReady: { type: Boolean, default: false },
    approvalStatus: {
      type: String,
      enum: ['draft', 'pending', 'approved', 'rejected'],
      default: 'draft',
    },
    paystackRecipientCode: { type: String, trim: true },
    agreedToTerms: { type: Boolean, default: false },
    submittedAt: { type: Date },
  },
  { _id: false }
)

const UserSchema = new Schema<IUser>(
  {
    fullname: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
      select: false,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
    },
 city: {
      type: String,
      trim: true,
    },
  avatarUrl: {
      type: String,
    },
    avatarPublicId: {
      type: String,
      select: false, // internal Cloudinary bookkeeping, never needs to leave the server
    },

    role: {
      type: String,
      enum: ['attendee', 'organizer', 'admin'],
      default: 'attendee',
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    isSuspended: {
      type: Boolean,
      default: false,
    },

    emailVerificationOTP: {
      type: String,
      select: false,
    },

    emailVerificationOTPExpiry: {
      type: Date,
      select: false,
    },

    emailVerificationAttempts: {
      type: Number,
      default: 0,
      select: false,
    },

    passwordResetOTP: {
      type: String,
      select: false,
    },

    passwordResetOTPExpiry: {
      type: Date,
      select: false,
    },

    passwordResetAttempts: {
      type: Number,
      default: 0,
      select: false,
    },

    failedLoginAttempts: {
      type: Number,
      default: 0,
      select: false,
    },

    lockUntil: {
      type: Date,
      select: false,
    },

    lastLogin: {
      type: Date,
    },

    organizerProfile: {
      type: OrganizerProfileSchema,
      default: undefined,
    },

    savedEvents: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Event',
      },
    ],
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
    },
    toObject: {
      virtuals: true,
    },
  }
)

/*
|--------------------------------------------------------------------------
| Explicit Indexes
|--------------------------------------------------------------------------
*/



UserSchema.index({ role: 1 })

UserSchema.index({ isVerified: 1 })

UserSchema.index({ createdAt: -1 })

UserSchema.index({
  role: 1,
  isVerified: 1,
})

UserSchema.index({
  'organizerProfile.approvalStatus': 1,
})

/*
|--------------------------------------------------------------------------
| Hooks
|--------------------------------------------------------------------------
*/
UserSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return
  const salt = await bcrypt.genSalt(10)
  this.password = await bcrypt.hash(this.password, salt)
})
/*
|--------------------------------------------------------------------------
| Methods
|--------------------------------------------------------------------------
*/

UserSchema.methods.matchPassword = async function (
  candidate: string
): Promise<boolean> {
  return bcrypt.compare(candidate, this.password)
}

UserSchema.methods.isLocked = function (): boolean {
  return !!(this.lockUntil && this.lockUntil > new Date())
}

UserSchema.methods.resetLoginAttempts = function (): void {
  this.failedLoginAttempts = 0
  this.lockUntil = undefined
}

/*
|--------------------------------------------------------------------------
| Model
|--------------------------------------------------------------------------
*/

const User =
  mongoose.models.User ||
  mongoose.model<IUser>('User', UserSchema, 'users')

export default User