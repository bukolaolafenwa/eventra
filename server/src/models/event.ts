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

// Embedded, not a separate collection — matches admin.controller.ts,
// promotion.controller.ts, and jobs/promotionExpiryCron.ts, all of which
// already read/write event.promotion.* directly. One promotion at a time
// per event (no history) — acceptable per PRD 11 ("keep it simple").
export interface IEventPromotion {
  package: string;
  status: "pending" | "approved" | "rejected";
  startsAt?: Date;
  endsAt?: Date;
  paidAt?: Date;
  paystackReference?: string;
}

export interface ILineupMember {
  name: string;
  role: string;
  imageUrl?: string;
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
  lineup?: ILineupMember[];
  // Provisional tier list — Figma's "Details" step (Optional extras) has an
  // Age policy toggle with a dropdown, but only "All Ages" was visible when
  // this was built. Not in the original PRD; confirm the real tiers with
  // design before treating this as final.
  agePolicy?: "all-ages" | "13+" | "16+" | "18+" | "21+";
  status: "draft" | "pending_approval" | "approved" | "rejected" | "cancelled" | "postponed" | "suspended";
  rejectionReason?: string;

  suspendedReason?: string;

  isPromoted: boolean;
  promotion?: IEventPromotion;

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

const LineupMemberSchema = new Schema<ILineupMember>({
  name: { type: String, required: true, trim: true },
  role: { type: String, required: true, trim: true },
  imageUrl: { type: String, trim: true },
});

const EventPromotionSchema = new Schema<IEventPromotion>(
  {
    package: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    startsAt: { type: Date },
    endsAt: { type: Date },
    paidAt: { type: Date },
    paystackReference: { type: String, trim: true },
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
    // default: undefined (not []) so events with no lineup don't get a
    // false-positive empty array from Mongoose's array defaulting.
    lineup: {
      type: [LineupMemberSchema],
      default: undefined,
    },
    // See IEvent.agePolicy comment — provisional tier list, confirm with design.
    agePolicy: {
      type: String,
      enum: ["all-ages", "13+", "16+", "18+", "21+"],
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
    promotion: {
      type: EventPromotionSchema,
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
    // Gross ticket sales, NOT net of Eventra's 5% commission — see
    // getEventDashboard in event.controller.ts, which computes the
    // organizer's actual payout as revenueTotal * 0.95 per PRD Section 8.
    // Whatever increments this on each sale should add the full ticket
    // price, not price-minus-commission.
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
// and admin review of promotion requests (via embedded promotion.status)
EventSchema.index({ organizer: 1, createdAt: -1 });
EventSchema.index({ status: 1, startDate: 1 });
EventSchema.index({ category: 1, startDate: 1 });
EventSchema.index({ "venue.city": 1 });
EventSchema.index({ isPromoted: -1, startDate: 1 });
EventSchema.index({ status: 1, minPrice: 1 });
EventSchema.index({ "promotion.status": 1 });
EventSchema.index({ title: "text", description: "text" });

// Export pattern — use existing model or create new one
const Event =
  mongoose.models.Event ||
  mongoose.model<IEvent>("Event", EventSchema, "events");

export default Event;