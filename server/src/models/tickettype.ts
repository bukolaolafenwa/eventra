import mongoose, { Schema, Document } from "mongoose";

export interface ITicketType extends Document {
  _id: mongoose.Types.ObjectId;
  event: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  price: number;
  currency: "NGN";
  quantity: number;
  quantitySold: number;
  purchaseLimitPerPerson?: number;
  salesStartDate?: Date;
  salesEndDate?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TicketTypeSchema = new Schema<ITicketType>(
  {
    event: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    // Store prices as whole naira. Convert to kobo in PaystackService.
    price: {
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
    quantity: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "Ticket quantity must be a whole number",
      },
    },
    quantitySold: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "Quantity sold must be a whole number",
      },
    },
    purchaseLimitPerPerson: {
      type: Number,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "Purchase limit must be a whole number",
      },
    },
    salesStartDate: {
      type: Date,
    },
    salesEndDate: {
      type: Date,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

TicketTypeSchema.virtual("quantityRemaining").get(
  function (this: ITicketType): number {
    return Math.max(0, this.quantity - this.quantitySold);
  },
);

TicketTypeSchema.pre("validate", function (this: ITicketType): void {
  if (this.quantitySold > this.quantity) {
    throw new Error("Quantity sold cannot exceed ticket quantity");
  }

  if (
    this.salesStartDate &&
    this.salesEndDate &&
    this.salesEndDate <= this.salesStartDate
  ) {
    throw new Error("Sales end date must be after sales start date");
  }
});

// Prevent duplicate ticket names within the same event.
TicketTypeSchema.index(
  { event: 1, name: 1 },
  {
    unique: true,
    collation: { locale: "en", strength: 2 },
  },
);

TicketTypeSchema.index({ event: 1, isActive: 1 });
TicketTypeSchema.index({ event: 1, price: 1 });

const TicketType =
  mongoose.models.TicketType ||
  mongoose.model<ITicketType>(
    "TicketType",
    TicketTypeSchema,
    "tickettypes",
  );

export default TicketType;