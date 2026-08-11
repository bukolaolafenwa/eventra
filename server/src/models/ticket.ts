import mongoose, { Document, Schema } from "mongoose";

export interface ITicket extends Document {
  _id: mongoose.Types.ObjectId;
  order: mongoose.Types.ObjectId;
  event: mongoose.Types.ObjectId;
  ticketType?: mongoose.Types.ObjectId;
  attendee?: mongoose.Types.ObjectId;
  attendeeName: string;
  attendeeEmail: string;
  attendeePhone?: string;
  ticketTypeName: string;
  code: string;
  pricePaid: number;
  currency: "NGN";
  status: "active" | "used" | "cancelled" | "refunded";
  issuedAt: Date;
  checkedInAt?: Date;
  checkedInBy?: mongoose.Types.ObjectId;
  cancelledAt?: Date;
  refundedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TicketSchema = new Schema<ITicket>(
  {
    order: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    event: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    ticketType: {
      type: Schema.Types.ObjectId,
      ref: "TicketType",
    },
    // Optional because Eventra supports guest checkout by email.
    attendee: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    attendeeName: {
      type: String,
      required: true,
      trim: true,
    },
    attendeeEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    attendeePhone: {
      type: String,
      trim: true,
    },
    // Snapshot retained even if the organizer later renames the ticket type.
    ticketTypeName: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    // Whole naira amount paid for this individual admission.
    pricePaid: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "Ticket price must be a whole naira amount",
      },
    },
    currency: {
      type: String,
      enum: ["NGN"],
      default: "NGN",
    },
    status: {
      type: String,
      enum: ["active", "used", "cancelled", "refunded"],
      default: "active",
    },
    issuedAt: {
      type: Date,
      default: Date.now,
    },
    checkedInAt: {
      type: Date,
    },
    checkedInBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    cancelledAt: {
      type: Date,
    },
    refundedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

TicketSchema.index({ order: 1 });
TicketSchema.index({ event: 1, status: 1 });
TicketSchema.index({ ticketType: 1 });
TicketSchema.index({ attendee: 1, createdAt: -1 });
TicketSchema.index({ attendeeEmail: 1, createdAt: -1 });
TicketSchema.index({ event: 1, checkedInAt: -1 });

const Ticket: mongoose.Model<ITicket> =
  (mongoose.models.Ticket as mongoose.Model<ITicket>) ||
  mongoose.model<ITicket>("Ticket", TicketSchema, "tickets");

export default Ticket;