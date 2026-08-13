import { randomBytes } from "crypto";
import mongoose from "mongoose";

import Order, { IOrderItem } from "../models/order.js";
import Ticket from "../models/ticket.js";
import { ErrorResponse } from "../middlewares/error.middleware.js";

export class TicketService {
  private validateObjectId(id: string, label: string): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ErrorResponse(`Invalid ${label} ID`, 400);
    }
  }


 private generateTicketId(): string {
  return `TK_${randomBytes(8)
    .toString("hex")
    .toUpperCase()}`;
}

  private generateTicketCode(): string {
    return `EVT-${randomBytes(10)
      .toString("hex")
      .toUpperCase()}`;
  }

  /**
   * Issues one individual ticket for every admission in a confirmed order.
   *
   * The order/sequence unique index makes this method idempotent:
   * repeated Paystack webhooks cannot create duplicate tickets.
   */
  async issueTicketsForOrder(
    orderId: string,
  ): Promise<unknown[]> {
    this.validateObjectId(orderId, "order");

    const order = await Order.findById(orderId)
      .select("-paystackAccessCode -__v")
      .lean();

    if (!order) {
      throw new ErrorResponse("Order not found", 404);
    }

    if (!["paid", "confirmed"].includes(order.status)) {
      throw new ErrorResponse(
        "Tickets can only be issued for a paid or confirmed order",
        409,
      );
    }

    const expectedTicketCount = order.items.reduce(
      (total: number, item: IOrderItem): number =>
        total + item.quantity,
      0,
    );

    const existingTickets = await Ticket.find({
      order: order._id,
    })
      .select("-__v")
      .sort({ sequence: 1 })
      .lean();

    if (existingTickets.length === expectedTicketCount) {
      return existingTickets;
    }

    if (existingTickets.length > expectedTicketCount) {
      throw new ErrorResponse(
        "Order has more tickets than expected",
        409,
      );
    }

    const existingSequences = new Set(
      existingTickets.map(
        (ticket): number => ticket.sequence,
      ),
    );

    const ticketDocuments: Array<Record<string, unknown>> = [];
    let sequence = 0;

    for (const item of order.items) {
      for (let count = 0; count < item.quantity; count++) {
        sequence++;

        if (existingSequences.has(sequence)) {
          continue;
        }

        ticketDocuments.push({
          order: order._id,
          ticketId: this.generateTicketId(),
          sequence,
          event: order.event,
          ticketType: item.ticketType,
          attendee: order.buyer,
          attendeeName: order.customer.fullname,
          attendeeEmail: order.customer.email,
          attendeePhone: order.customer.phone,
          ticketTypeName: item.ticketTypeName,
          code: this.generateTicketCode(),
          pricePaid: item.unitPrice,
          currency: order.currency,
          status: "active",
          issuedAt: new Date(),
        });
      }
    }

    if (ticketDocuments.length > 0) {
      try {
        await Ticket.insertMany(ticketDocuments, {
          ordered: true,
        });
      } catch (error: unknown) {
        const mongoError = error as { code?: number };

        // Another webhook request may have issued the same sequences
        // concurrently. Any non-duplicate error must still fail.
        if (mongoError.code !== 11000) {
          throw error;
        }
      }
    }

    const issuedTickets = await Ticket.find({
      order: order._id,
    })
      .select("-__v")
      .sort({ sequence: 1 })
      .lean();

    if (issuedTickets.length !== expectedTicketCount) {
      throw new ErrorResponse(
        "Ticket issuance did not complete successfully",
        500,
      );
    }

    return issuedTickets;
  }
}

export const ticketService = new TicketService();