import { Router } from "express";

import {
  createTicketTypeController,
  deleteTicketTypeController,
  getOrganizerTicketTypesController,
  getPublicTicketTypesController,
  updateTicketTypeController,
} from "../controllers/tickettype.controller.js";
import {
  requireRole,
  verifySession,
} from "../middlewares/auth.middleware.js";
import { validateFormData } from "../middlewares/schema.middleware.js";
import { customRateLimiter } from "../middlewares/rateLimit.middleware.js";
import {
  cacheMiddleware,
  clearCache,
} from "../middlewares/cache.middleware.js";
import {
  createTicketTypeSchema,
  updateTicketTypeSchema,
} from "../lib/schemaValidation.js";

const router = Router();

/**
 * @route   GET /api/v1/events/:eventId/ticket-types
 * @desc    Retrieve active ticket types for a public event
 * @access  Public
 */
router.get(
  "/:eventId/ticket-types",
  cacheMiddleware(60),
  getPublicTicketTypesController,
);

/**
 * @route   GET /api/v1/events/:eventId/ticket-types/manage
 * @desc    Retrieve all ticket types for the organizer's event
 * @access  Organizer
 */
router.get(
  "/:eventId/ticket-types/manage",
  verifySession,
  requireRole("organizer"),
  getOrganizerTicketTypesController,
);

/**
 * @route   POST /api/v1/events/:eventId/ticket-types
 * @desc    Create a paid ticket type
 * @access  Organizer
 */
router.post(
  "/:eventId/ticket-types",
  customRateLimiter(10),
  verifySession,
  requireRole("organizer"),
  validateFormData(createTicketTypeSchema),
  clearCache("events"),
  createTicketTypeController,
);

/**
 * @route   PATCH /api/v1/events/:eventId/ticket-types/:ticketTypeId
 * @desc    Update a ticket type
 * @access  Organizer
 */
router.patch(
  "/:eventId/ticket-types/:ticketTypeId",
  customRateLimiter(10),
  verifySession,
  requireRole("organizer"),
  validateFormData(updateTicketTypeSchema),
  clearCache("events"),
  updateTicketTypeController,
);

/**
 * @route   DELETE /api/v1/events/:eventId/ticket-types/:ticketTypeId
 * @desc    Delete an unsold ticket type
 * @access  Organizer
 */
router.delete(
  "/:eventId/ticket-types/:ticketTypeId",
  customRateLimiter(5),
  verifySession,
  requireRole("organizer"),
  clearCache("events"),
  deleteTicketTypeController,
);

export default router;