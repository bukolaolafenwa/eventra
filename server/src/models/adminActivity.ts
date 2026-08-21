import mongoose, { Document, Schema } from 'mongoose'

export type AdminActivityAction =
  | 'event_approved'
  | 'event_rejected'
  | 'event_suspended'
  | 'event_reinstated'
  | 'organizer_approved'
  | 'organizer_rejected'
  | 'promotion_approved'
  | 'promotion_rejected'
  | 'refund_approved'
  | 'refund_rejected'

export type AdminActivitySubject =
  | 'event'
  | 'organizer'
  | 'promotion'
  | 'refund'

export interface IAdminActivity extends Document {
  actor: mongoose.Types.ObjectId
  action: AdminActivityAction
  subjectType: AdminActivitySubject
  subjectId: mongoose.Types.ObjectId
  message: string
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

const AdminActivitySchema = new Schema<IAdminActivity>(
  {
    actor: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    action: {
      type: String,
      enum: [
        'event_approved',
        'event_rejected',
        'event_suspended',
        'event_reinstated',
        'organizer_approved',
        'organizer_rejected',
        'promotion_approved',
        'promotion_rejected',
        'refund_approved',
        'refund_rejected',
      ],
      required: true,
    },
    subjectType: {
      type: String,
      enum: ['event', 'organizer', 'promotion', 'refund'],
      required: true,
    },
    subjectId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
  },
  { timestamps: true },
)

AdminActivitySchema.index({ createdAt: -1 })
AdminActivitySchema.index({ action: 1, createdAt: -1 })
AdminActivitySchema.index({ subjectType: 1, subjectId: 1, createdAt: -1 })

const AdminActivity: mongoose.Model<IAdminActivity> =
  (mongoose.models.AdminActivity as mongoose.Model<IAdminActivity>) ||
  mongoose.model<IAdminActivity>(
    'AdminActivity',
    AdminActivitySchema,
    'admin_activities',
  )

export default AdminActivity
