import mongoose, { Schema, Document } from 'mongoose'

export interface IOrganizer extends Document {
  user: mongoose.Types.ObjectId
  businessName: string
  bio?: string
  phone: string
  logo?: string
  bankName?: string
  accountName?: string
  accountNumber?: string
  approvalStatus: 'pending' | 'approved' | 'rejected'
  createdAt: Date
  updatedAt: Date
}

const organizerSchema = new Schema<IOrganizer>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    businessName: { type: String, required: true, trim: true },
    bio: { type: String, trim: true },
    phone: { type: String, required: true, trim: true },
    logo: { type: String, trim: true },
    bankName: { type: String, trim: true },
    accountName: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
  },
  { timestamps: true }
)

export const Organizer = mongoose.model<IOrganizer>('Organizer', organizerSchema)