import { Request, Response } from "express";

import {
  CreateTicketTypeInput,
  UpdateTicketTypeInput,
  ticketTypeService,
} from "../services/tickettype.service.js";
import { sendTsRestSuccess } from "../lib/responseHandler.js";
import tryCatchWrapper from "../lib/tryCatchWrapper.js";

interface EventParams {
  eventId: string;
}

interface TicketTypeParams extends EventParams {
  ticketTypeId: string;
}

/**
 * Creates a paid ticket type for an organizer's event.
 */
export const createTicketTypeController = tryCatchWrapper(
  async (
    req: Request<EventParams, unknown, CreateTicketTypeInput>,
    res: Response,
  ): Promise<void> => {
    const ticketType = await ticketTypeService.createTicketType(
      req.params.eventId,
      req.session.userId!,
      req.body,
    );

    return sendTsRestSuccess(res, 201, {
      success: true,
      message: "Ticket type created successfully",
      body: ticketType,
    });
  },
);

/**
 * Retrieves active ticket types for a public event.
 */
export const getPublicTicketTypesController = tryCatchWrapper(
  async (
    req: Request<EventParams>,
    res: Response,
  ): Promise<void> => {
    const ticketTypes =
      await ticketTypeService.getPublicTicketTypes(
        req.params.eventId,
      );

    return sendTsRestSuccess(res, 200, {
      success: true,
      message: "Ticket types retrieved successfully",
      body: ticketTypes,
    });
  },
);

/**
 * Retrieves all ticket types belonging to an organizer's event.
 */
export const getOrganizerTicketTypesController = tryCatchWrapper(
  async (
    req: Request<EventParams>,
    res: Response,
  ): Promise<void> => {
    const ticketTypes =
      await ticketTypeService.getOrganizerTicketTypes(
        req.params.eventId,
        req.session.userId!,
      );

    return sendTsRestSuccess(res, 200, {
      success: true,
      message: "Organizer ticket types retrieved successfully",
      body: ticketTypes,
    });
  },
);

/**
 * Updates a ticket type belonging to an organizer's event.
 */
export const updateTicketTypeController = tryCatchWrapper(
  async (
    req: Request<
      TicketTypeParams,
      unknown,
      UpdateTicketTypeInput
    >,
    res: Response,
  ): Promise<void> => {
    const ticketType = await ticketTypeService.updateTicketType(
      req.params.eventId,
      req.params.ticketTypeId,
      req.session.userId!,
      req.body,
    );

    return sendTsRestSuccess(res, 200, {
      success: true,
      message: "Ticket type updated successfully",
      body: ticketType,
    });
  },
);

/**
 * Deletes an unsold ticket type belonging to an organizer's event.
 */
export const deleteTicketTypeController = tryCatchWrapper(
  async (
    req: Request<TicketTypeParams>,
    res: Response,
  ): Promise<void> => {
    await ticketTypeService.deleteTicketType(
      req.params.eventId,
      req.params.ticketTypeId,
      req.session.userId!,
    );

    return sendTsRestSuccess<undefined>(res, 200, {
      success: true,
      message: "Ticket type deleted successfully",
    });
  },
);