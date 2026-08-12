import mongoose, { Document, Schema } from "mongoose";

export interface IOrderItem {
  ticketType?: mongoose.Types.ObjectId;
  ticketTypeName: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
}

export interface IOrderCustomer {
  fullname: string;
  email: string;
  phone?: string;
}

export interface IOrder extends Document {
  _id: mongoose.Types.ObjectId;
  orderNumber: string;
  buyer?: mongoose.Types.ObjectId;
  event: mongoose.Types.ObjectId;
  customer: IOrderCustomer;
  items: IOrderItem[];
  type: "free" | "paid";
  subtotal: number;
  serviceFee: number;
  totalAmount: number;
  currency: "NGN";
  paymentProvider: "none" | "paystack";
  status:
    | "pending"
    | "confirmed"
    | "paid"
    | "failed"
    | "expired"
    | "cancelled"
    | "partially_refunded"
    | "refunded";
  paystackReference?: string;
  paystackAccessCode?: string;
  refundedAmount: number;
  paidAt?: Date;
  confirmedAt?: Date;

  ticketConfirmationEmailSentAt?: Date;
  ticketConfirmationEmailSendingAt?: Date;

  failedAt?: Date;
  expiresAt?: Date;
  cancelledAt?: Date;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const OrderItemSchema = new Schema<IOrderItem>(
  {
    ticketType: {
      type: Schema.Types.ObjectId,
      ref: "TicketType",
    },
    // Snapshot fields remain unchanged if a ticket type is later edited.
    ticketTypeName: {
      type: String,
      required: true,
      trim: true,
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "Unit price must be a whole naira amount",
      },
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "Quantity must be a whole number",
      },
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "Item subtotal must be a whole naira amount",
      },
    },
  },
  { _id: false },
);

const OrderCustomerSchema = new Schema<IOrderCustomer>(
  {
    fullname: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
  },
  { _id: false },
);

const OrderSchema = new Schema<IOrder>(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    // Optional because guest checkout is supported.
    buyer: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    event: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    customer: {
      type: OrderCustomerSchema,
      required: true,
    },
    items: {
      type: [OrderItemSchema],
      required: true,
      validate: {
        validator: (items: IOrderItem[]): boolean =>
          Array.isArray(items) && items.length > 0,
        message: "Order must contain at least one item",
      },
    },
    type: {
      type: String,
      enum: ["free", "paid"],
      required: true,
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "Subtotal must be a whole naira amount",
      },
    },
    // Eventra's 5% fee, calculated by the backend.
    serviceFee: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "Service fee must be a whole naira amount",
      },
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "Total amount must be a whole naira amount",
      },
    },
    currency: {
      type: String,
      enum: ["NGN"],
      default: "NGN",
    },
    paymentProvider: {
      type: String,
      enum: ["none", "paystack"],
      required: true,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "paid",
        "failed",
        "expired",
        "cancelled",
        "partially_refunded",
        "refunded",
      ],
      required: true,
      default: "pending",
    },
    paystackReference: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    paystackAccessCode: {
      type: String,
      trim: true,
      select: false,
    },
    refundedAmount: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "Refunded amount must be a whole naira amount",
      },
    },
    paidAt: {
      type: Date,
    },
    confirmedAt: {
      type: Date,
    },
    ticketConfirmationEmailSentAt: {
    type: Date,
    },
    ticketConfirmationEmailSendingAt: {
    type: Date,
    },
    failedAt: {
      type: Date,
    },
    // Pending paid orders can hold inventory for a limited checkout window.
    expiresAt: {
      type: Date,
    },
    cancelledAt: {
      type: Date,
    },
    failureReason: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

OrderSchema.index({ buyer: 1, createdAt: -1 });
OrderSchema.index({ "customer.email": 1, createdAt: -1 });
OrderSchema.index({ event: 1, status: 1 });
OrderSchema.index({ status: 1, expiresAt: 1 });

const Order: mongoose.Model<IOrder> =
  (mongoose.models.Order as mongoose.Model<IOrder>) ||
  mongoose.model<IOrder>("Order", OrderSchema, "orders");

export default Order;