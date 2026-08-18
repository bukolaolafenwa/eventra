import mongoose, {
  Document,
  Schema,
} from 'mongoose'

export type PayoutStatus =
  | 'pending'
  | 'processing'
  | 'otp_required'
  | 'paid'
  | 'failed'
  | 'reversed'

export interface IPayoutDestination {
  bankName: string
  bankCode: string
  accountName: string
  accountNumberLast4: string
}

export interface IPayout extends Document {
  _id: mongoose.Types.ObjectId
  organizer: mongoose.Types.ObjectId
  event: mongoose.Types.ObjectId
  orders: mongoose.Types.ObjectId[]

  grossAmount: number
  refundedAmount: number
  commissionAmount: number
  netAmount: number
  currency: 'NGN'

  provider: 'paystack'
  recipientCode: string
  reference: string
  transferCode?: string
  providerStatus?: string

  destination: IPayoutDestination
  status: PayoutStatus
  failureReason?: string

  eligibleAt: Date
  initiatedBy: mongoose.Types.ObjectId
  initiatedAt?: Date
  paidAt?: Date
  failedAt?: Date
  reversedAt?: Date

  createdAt: Date
  updatedAt: Date
}

const PayoutDestinationSchema =
  new Schema<IPayoutDestination>(
    {
      bankName: {
        type: String,
        required: true,
        trim: true,
      },
      bankCode: {
        type: String,
        required: true,
        trim: true,
      },
      accountName: {
        type: String,
        required: true,
        trim: true,
      },
      accountNumberLast4: {
        type: String,
        required: true,
        trim: true,
        minlength: 4,
        maxlength: 4,
      },
    },
    {
      _id: false,
    },
  )

const PayoutSchema = new Schema<IPayout>(
  {
    organizer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    event: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
    },
    orders: {
      type: [Schema.Types.ObjectId],
      ref: 'Order',
      required: true,
      validate: {
        validator: (
          orders: mongoose.Types.ObjectId[],
        ): boolean => orders.length > 0,
        message:
          'A payout must contain at least one order',
      },
    },

    grossAmount: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message:
          'Gross amount must be a whole Naira amount',
      },
    },
    refundedAmount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message:
          'Refunded amount must be a whole Naira amount',
      },
    },
    commissionAmount: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message:
          'Commission must be a whole Naira amount',
      },
    },
    netAmount: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message:
          'Net payout must be a positive whole Naira amount',
      },
    },
    currency: {
      type: String,
      enum: ['NGN'],
      default: 'NGN',
    },

    provider: {
      type: String,
      enum: ['paystack'],
      default: 'paystack',
    },
    recipientCode: {
      type: String,
      required: true,
      trim: true,
    },
    reference: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    transferCode: {
      type: String,
      trim: true,
    },
    providerStatus: {
      type: String,
      trim: true,
    },

    destination: {
      type: PayoutDestinationSchema,
      required: true,
    },
    status: {
      type: String,
      enum: [
        'pending',
        'processing',
        'otp_required',
        'paid',
        'failed',
        'reversed',
      ],
      default: 'pending',
      required: true,
    },
    failureReason: {
      type: String,
      trim: true,
    },

    eligibleAt: {
      type: Date,
      required: true,
    },
    initiatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    initiatedAt: {
      type: Date,
    },
    paidAt: {
      type: Date,
    },
    failedAt: {
      type: Date,
    },
    reversedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
)

// A Paystack reference must identify exactly one payout.
PayoutSchema.index(
  { reference: 1 },
  { unique: true },
)

// Each event has one payout lifecycle. Failed or reversed transfers must
// be reconciled on the existing record instead of creating a second payout.
PayoutSchema.index(
  { event: 1 },
  { unique: true },
)

/**
 * Enforces payout accounting integrity before saving.
 *
 * Each order may appear only once within a payout, refunds cannot exceed
 * gross sales, and the organizer's net payout must exactly equal gross
 * sales minus refunds and Eventra's commission. These checks prevent an
 * inconsistent or inflated payout record from reaching Paystack.
 */
PayoutSchema.pre(
  'validate',
  function validatePayoutAccounting() {
    const uniqueOrderIds = new Set(
      this.orders.map(orderId =>
        orderId.toString(),
      ),
    )

    if (
      uniqueOrderIds.size !==
      this.orders.length
    ) {
      this.invalidate(
        'orders',
        'A payout cannot contain duplicate orders',
      )
    }

    if (
      this.refundedAmount >
      this.grossAmount
    ) {
      this.invalidate(
        'refundedAmount',
        'Refunded amount cannot exceed gross amount',
      )
    }

    const expectedNetAmount =
      this.grossAmount -
      this.refundedAmount -
      this.commissionAmount

    if (
      this.netAmount !== expectedNetAmount
    ) {
      this.invalidate(
        'netAmount',
        'Net amount must equal gross amount minus refunds and commission',
      )
    }
  },
)

// A paid order must never be included in two payout records.
// Since `orders` is an array, MongoDB creates a unique multikey index.
PayoutSchema.index(
  { orders: 1 },
  { unique: true },
)

PayoutSchema.index({
  organizer: 1,
  createdAt: -1,
})

PayoutSchema.index({
  event: 1,
  status: 1,
})

PayoutSchema.index({
  status: 1,
  eligibleAt: 1,
})

const Payout: mongoose.Model<IPayout> =
  (mongoose.models
    .Payout as mongoose.Model<IPayout>) ||
  mongoose.model<IPayout>(
    'Payout',
    PayoutSchema,
    'payouts',
  )

export default Payout