import mongoose, { Schema, Document } from "mongoose";

export interface IEvent extends Document {
  _id: mongoose.Types.ObjectId;
  title: string;
  description: string;
  photo: string;
  venue: string;
  city: string;
  date: Date;
  categoryId: mongoose.Types.ObjectId;
  type: "free" | "paid";
  organizerId: mongoose.Types.ObjectId;
  status:
    | "draft"
    | "pending_approval"
    | "approved"
    | "rejected"
    | "cancelled"
    | "postponed";
  capacity?: number;
  reservedCount: number;
  refundPolicy?: string;
  slug: string;
  isPromoted: boolean;
  promotionId?: mongoose.Types.ObjectId;
}

const EventSchema = new Schema<IEvent>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    photo: { type: String, required: true },
    venue: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    date: { type: Date, required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    type: { type: String, enum: ["free", "paid"], required: true },
    organizerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: [
        "draft",
        "pending_approval",
        "approved",
        "rejected",
        "cancelled",
        "postponed",
      ],
      default: "draft",
    },
    capacity: { type: Number },
    reservedCount: { type: Number, default: 0 },
    refundPolicy: {
      type: String,
      required: function (this: IEvent) {
        return this.type === "paid";
      },
    },
    slug: { type: String, required: true, trim: true, lowercase: true },
    isPromoted: { type: Boolean, default: false },
    promotionId: { type: Schema.Types.ObjectId, ref: "Promotion" },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Indexes go after schema definition
EventSchema.index({ slug: 1 }, { unique: true });
EventSchema.index({ organizerId: 1 });
EventSchema.index({ city: 1 });
EventSchema.index({ status: 1, date: 1 });

// Export pattern — use existing model or create new one
const Event =
  mongoose.models.Event ||
  mongoose.model<IEvent>("Event", EventSchema, "events");

export default Event;