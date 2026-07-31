import mongoose, { Schema, Document } from "mongoose";

export interface IEventVenue {
  name: string;
  address: string;
  city: string;
  state?: string;
}

export interface IRefundPolicy {
  type: "no-refunds" | "refund-until-days-before";
  daysBefore?: number;
}

export interface IEvent extends Document {
  _id: mongoose.Types.ObjectId;
  organizer: mongoose.Types.ObjectId;
  title: string;
  slug: string;
  description: string;
  category: mongoose.Types.ObjectId;
  type: "free" | "paid";
  coverImage: string;
  venue: IEventVenue;
  startDate: Date;
  endDate?: Date;
  capacity?: number;
  refundPolicy?: IRefundPolicy;
  status: "draft" | "pending_approval" | "approved" | "rejected" | "cancelled" | "postponed" | "suspended";
  rejectionReason?: string;

  suspendedReason?: string;


  isPromoted: boolean;
  promotionId?: mongoose.Types.ObjectId;

  reservationsCount: number;
  ticketsSoldCount: number;
  revenueTotal: number;
  minPrice: number;
  publishedAt?: Date;
  cancelledAt?: Date;
  postponedTo?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const EventVenueSchema = new Schema<IEventVenue>(
  {
    name: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, trim: true },
  },
  { _id: false },
);

const RefundPolicySchema = new Schema<IRefundPolicy>(
  {
    type: {
      type: String,
      enum: ["no-refunds", "refund-until-days-before"],
      default: "no-refunds",
    },
    daysBefore: { type: Number, min: 0 },
  },
  { _id: false },
);

const EventSchema = new Schema<IEvent>(
  {
    organizer: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    type: {
      type: String,
      enum: ["free", "paid"],
      required: true,
    },
    coverImage: {
      type: String,
      required: true,
      trim: true,
    },
    venue: {
      type: EventVenueSchema,
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
    },

    capacity: {
      type: Number,
      min: 0,
    },
    refundPolicy: {
      type: RefundPolicySchema,
      required: function (this: IEvent) {
        return this.type === "paid";
      },
    },
    status: {
      type: String,
      enum: ["draft", "pending_approval", "approved", "rejected", "cancelled", "postponed", "suspended"],
      default: "draft",
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
    suspendedReason: {
      type: String,
      trim: true,
    },

    isPromoted: {
      type: Boolean,
      default: false,
    },
    promotionId: {
      type: Schema.Types.ObjectId,
      ref: "Promotion",
    },

    reservationsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    ticketsSoldCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    revenueTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
   
    minPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    publishedAt: {
      type: Date,
    },
    cancelledAt: {
      type: Date,
    },
    postponedTo: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Indexes — support Explore/search, organizer dashboard, featured placement,
// and admin review of promotion requests (via Promotion collection, not here)
EventSchema.index({ organizer: 1, createdAt: -1 });
EventSchema.index({ status: 1, startDate: 1 });
EventSchema.index({ category: 1, startDate: 1 });
EventSchema.index({ "venue.city": 1 });
EventSchema.index({ isPromoted: -1, startDate: 1 });
EventSchema.index({ status: 1, minPrice: 1 });
EventSchema.index({ promotionId: 1 });
EventSchema.index({ title: "text", description: "text" });

// Export pattern — use existing model or create new one
const Event =
  mongoose.models.Event ||
  mongoose.model<IEvent>("Event", EventSchema, "events");

export default Event;