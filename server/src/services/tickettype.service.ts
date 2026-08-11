import mongoose from "mongoose";

import Event, { IEvent } from "../models/event.js";
import TicketType, {
  ITicketType,
} from "../models/tickettype.js";
import { ErrorResponse } from "../middlewares/error.middleware.js";

export interface CreateTicketTypeInput {
  name: string;
  description?: string;
  price: number;
  quantity: number;
  purchaseLimitPerPerson?: number;
  salesStartDate?: Date;
  salesEndDate?: Date;
}

export interface UpdateTicketTypeInput {
  name?: string;
  description?: string;
  price?: number;
  quantity?: number;
  purchaseLimitPerPerson?: number;
  salesStartDate?: Date;
  salesEndDate?: Date;
  isActive?: boolean;
}

export class TicketTypeService {
  private validateObjectId(id: string, label: string): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ErrorResponse(`Invalid ${label} ID`, 400);
    }
  }

  private async getOwnedEvent(
    eventId: string,
    organizerId: string,
  ): Promise<IEvent> {
    this.validateObjectId(eventId, "event");
    this.validateObjectId(organizerId, "organizer");

    const event = await Event.findOne({
      _id: eventId,
      organizer: organizerId,
    });

    if (!event) {
      throw new ErrorResponse("Event not found", 404);
    }

    if (event.type !== "paid") {
      throw new ErrorResponse(
        "Ticket types can only be created for paid events",
        400,
      );
    }

    if (
      ["pending_approval", "cancelled", "suspended"].includes(
        event.status,
      )
    ) {
      throw new ErrorResponse(
        `Ticket types cannot be managed while the event is ${event.status}`,
        409,
      );
    }

    return event;
  }

  private validatePrice(price: number): void {
    if (!Number.isInteger(price) || price <= 0) {
      throw new ErrorResponse(
        "Paid ticket price must be a positive whole naira amount",
        400,
      );
    }
  }

  private validatePurchaseLimit(
    purchaseLimitPerPerson: number | undefined,
    quantity: number,
  ): void {
    if (
      purchaseLimitPerPerson !== undefined &&
      purchaseLimitPerPerson > quantity
    ) {
      throw new ErrorResponse(
        "Purchase limit cannot exceed ticket quantity",
        400,
      );
    }
  }

  private validateSalesPeriod(
    event: IEvent,
    salesStartDate?: Date,
    salesEndDate?: Date,
  ): void {
    if (
      salesStartDate &&
      salesEndDate &&
      salesEndDate <= salesStartDate
    ) {
      throw new ErrorResponse(
        "Sales end date must be after sales start date",
        400,
      );
    }

    if (salesStartDate && salesStartDate >= event.startDate) {
      throw new ErrorResponse(
        "Ticket sales must start before the event",
        400,
      );
    }

    if (salesEndDate && salesEndDate > event.startDate) {
      throw new ErrorResponse(
        "Ticket sales cannot end after the event starts",
        400,
      );
    }
  }

 private async validateEventCapacity(
  event: IEvent,
  quantity: number,
  excludedTicketTypeId?: string,
): Promise<void> {
  if (event.capacity === undefined) {
    return;
  }

 const filter: {
  event: mongoose.Types.ObjectId;
  _id?: { $ne: mongoose.Types.ObjectId };
} = {
  event: event._id,
};

  if (excludedTicketTypeId) {
    filter._id = {
      $ne: new mongoose.Types.ObjectId(excludedTicketTypeId),
    };
  }

  const otherTicketTypes = await TicketType.find(filter)
    .select("quantity")
    .lean();

  const existingQuantity = otherTicketTypes.reduce(
    (
      total: number,
      ticketType: { quantity: number },
    ): number => total + ticketType.quantity,
    0,
  );

  if (existingQuantity + quantity > event.capacity) {
    throw new ErrorResponse(
      "Total ticket quantity cannot exceed event capacity",
      400,
    );
  }
}

  private async recalculateEventMinimumPrice(
    eventId: mongoose.Types.ObjectId,
  ): Promise<void> {
    const cheapestTicket = await TicketType.findOne({
      event: eventId,
      isActive: true,
    })
      .select("price")
      .sort({ price: 1 })
      .lean();

    await Event.updateOne(
      { _id: eventId },
      { $set: { minPrice: cheapestTicket?.price ?? 0 } },
    );
  }

  async createTicketType(
    eventId: string,
    organizerId: string,
    payload: CreateTicketTypeInput,
  ): Promise<ITicketType> {
    const event = await this.getOwnedEvent(eventId, organizerId);

    this.validatePrice(payload.price);
    this.validatePurchaseLimit(
      payload.purchaseLimitPerPerson,
      payload.quantity,
    );
    this.validateSalesPeriod(
      event,
      payload.salesStartDate,
      payload.salesEndDate,
    );

    const duplicate = await TicketType.exists({
      event: event._id,
      name: payload.name,
    });

    if (duplicate) {
      throw new ErrorResponse(
        "A ticket type with this name already exists",
        409,
      );
    }

    await this.validateEventCapacity(event, payload.quantity);

    const ticketType = await TicketType.create({
      ...payload,
      event: event._id,
    });

    await this.recalculateEventMinimumPrice(event._id);

    return ticketType;
  }

  async getPublicTicketTypes(
    eventId: string,
  ): Promise<Array<Record<string, unknown>>> {
    this.validateObjectId(eventId, "event");

    const event = await Event.findOne({
      _id: eventId,
      status: { $in: ["approved", "postponed"] },
      type: "paid",
    })
      .select("_id")
      .lean();

    if (!event) {
      throw new ErrorResponse("Event not found", 404);
    }

    const ticketTypes = await TicketType.find({
      event: eventId,
      isActive: true,
    })
      .select("-__v")
      .sort({ price: 1 })
      .lean();

    return ticketTypes.map((ticketType) => ({
      ...ticketType,
      quantityRemaining: Math.max(
        0,
        ticketType.quantity - ticketType.quantitySold,
      ),
    }));
  }

  async getOrganizerTicketTypes(
    eventId: string,
    organizerId: string,
  ): Promise<Array<Record<string, unknown>>> {
    await this.getOwnedEvent(eventId, organizerId);

    const ticketTypes = await TicketType.find({ event: eventId })
      .select("-__v")
      .sort({ price: 1 })
      .lean();

    return ticketTypes.map((ticketType) => ({
      ...ticketType,
      quantityRemaining: Math.max(
        0,
        ticketType.quantity - ticketType.quantitySold,
      ),
    }));
  }

  async updateTicketType(
    eventId: string,
    ticketTypeId: string,
    organizerId: string,
    payload: UpdateTicketTypeInput,
  ): Promise<ITicketType> {
    const event = await this.getOwnedEvent(eventId, organizerId);
    this.validateObjectId(ticketTypeId, "ticket type");

    const ticketType = await TicketType.findOne({
      _id: ticketTypeId,
      event: event._id,
    });

    if (!ticketType) {
      throw new ErrorResponse("Ticket type not found", 404);
    }

    const nextPrice = payload.price ?? ticketType.price;
    const nextQuantity = payload.quantity ?? ticketType.quantity;
    const nextPurchaseLimit =
      payload.purchaseLimitPerPerson ??
      ticketType.purchaseLimitPerPerson;
    const nextSalesStartDate =
      payload.salesStartDate ?? ticketType.salesStartDate;
    const nextSalesEndDate =
      payload.salesEndDate ?? ticketType.salesEndDate;

    this.validatePrice(nextPrice);
    this.validatePurchaseLimit(
      nextPurchaseLimit,
      nextQuantity,
    );
    this.validateSalesPeriod(
      event,
      nextSalesStartDate,
      nextSalesEndDate,
    );

    if (nextQuantity < ticketType.quantitySold) {
      throw new ErrorResponse(
        "Ticket quantity cannot be lower than quantity already sold",
        400,
      );
    }

    await this.validateEventCapacity(
      event,
      nextQuantity,
      ticketTypeId,
    );

    if (
      payload.name &&
      payload.name !== ticketType.name
    ) {
      const duplicate = await TicketType.exists({
        event: event._id,
        name: payload.name,
        _id: { $ne: ticketTypeId },
      });

      if (duplicate) {
        throw new ErrorResponse(
          "A ticket type with this name already exists",
          409,
        );
      }
    }

    Object.assign(ticketType, payload);
    await ticketType.save();

    await this.recalculateEventMinimumPrice(event._id);

    return ticketType;
  }

  async deleteTicketType(
    eventId: string,
    ticketTypeId: string,
    organizerId: string,
  ): Promise<void> {
    const event = await this.getOwnedEvent(eventId, organizerId);
    this.validateObjectId(ticketTypeId, "ticket type");

    const ticketType = await TicketType.findOne({
      _id: ticketTypeId,
      event: event._id,
    });

    if (!ticketType) {
      throw new ErrorResponse("Ticket type not found", 404);
    }

    if (ticketType.quantitySold > 0) {
      throw new ErrorResponse(
        "A ticket type with completed sales cannot be deleted; deactivate it instead",
        409,
      );
    }

    await ticketType.deleteOne();
    await this.recalculateEventMinimumPrice(event._id);
  }
}

export const ticketTypeService = new TicketTypeService();