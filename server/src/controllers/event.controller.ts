import { Request, Response, NextFunction } from 'express';
import { EventService } from '../services/event.service.js';
import { CreateEventInput, UpdateEventInput, EventFilters } from '../types/event.types.js';
import { z } from 'zod';
import tryCatchWrapper from '../lib/tryCatchWrapper.js';   
import { sendTsRestSuccess, sendTsRestError } from '../lib/responseHandler.js'; 

// --- Zod Schemas ---
const createEventSchema = z.object({
  title: z.string().min(3).max(100),
  description: z.string().optional(),
  date: z.string().datetime(),
  location: z.string().optional(),
  capacity: z.number().int().positive().optional(),
  price: z.number().nonnegative().optional(),
});

const updateEventSchema = z.object({
  title: z.string().min(3).max(100).optional(),
  description: z.string().optional(),
  date: z.string().datetime().optional(),
  location: z.string().optional(),
  capacity: z.number().int().positive().optional(),
  price: z.number().nonnegative().optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const searchQuerySchema = z.object({
  q: z.string().min(1),
});

const filterQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  location: z.string().optional(),
  minPrice: z.string().regex(/^\d+$/).optional().transform(Number),
  maxPrice: z.string().regex(/^\d+$/).optional().transform(Number),
});

// Turning manual `postponeEvent` validation into a Zod schema for consistency
const postponeEventSchema = z.object({
  newDate: z.string().datetime(),
});

export class EventController {
  constructor(private eventService: EventService) {}

  // -------- CRUD operations --------
   createEvent = tryCatchWrapper(async (req: Request, res: Response) => {
    const validatedData = createEventSchema.parse(req.body) as CreateEventInput;
    const event = await this.eventService.createEvent(validatedData);
    sendTsRestSuccess(res, 201, { 
      success: true, // <-- Added
      message: 'Event created successfully', 
      body: event 
    });
  });

  getEvents = tryCatchWrapper(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const result = await this.eventService.getEvents(page, limit);
    sendTsRestSuccess(res, 200, { 
      success: true, // <-- Added
      message: 'Events fetched successfully', 
      body: result 
    });
  });

  getEventById = tryCatchWrapper(async (req: Request, res: Response) => {
    const { id } = idParamSchema.parse(req.params);
    const event = await this.eventService.getEventById(id);
    if (!event) {
      return sendTsRestError(res, 404, 'Event not found');
    }
    sendTsRestSuccess(res, 200, { 
      success: true, // <-- Added
      message: 'Event fetched successfully', 
      body: event 
    });
  });

  updateEvent = tryCatchWrapper(async (req: Request, res: Response) => {
    const { id } = idParamSchema.parse(req.params);
    const validatedData = updateEventSchema.parse(req.body) as UpdateEventInput;
    const updated = await this.eventService.updateEvent(id, validatedData);
    if (!updated) {
      return sendTsRestError(res, 404, 'Event not found');
    }
    sendTsRestSuccess(res, 200, { 
      success: true, // <-- Added
      message: 'Event updated successfully', 
      body: updated 
    });
  });

  deleteEvent = tryCatchWrapper(async (req: Request, res: Response) => {
    const { id } = idParamSchema.parse(req.params);
    const deleted = await this.eventService.deleteEvent(id);
    if (!deleted) {
      return sendTsRestError(res, 404, 'Event not found');
    }
    sendTsRestSuccess(res, 200, { 
      success: true, // <-- Added
      message: 'Event deleted successfully', 
      body: { message: 'Event deleted successfully' } 
    });
  });

    // -------- Search & Filter --------
  searchEvents = tryCatchWrapper(async (req: Request, res: Response) => {
    const { q } = searchQuerySchema.parse(req.query);
    const results = await this.eventService.searchEvents(q);
    sendTsRestSuccess(res, 200, { 
      success: true, // <-- ADDED
      message: 'Search results fetched successfully', 
      body: results 
    });
  });

  filterEvents = tryCatchWrapper(async (req: Request, res: Response) => {
    const filters = filterQuerySchema.parse(req.query) as EventFilters;
    const results = await this.eventService.filterEvents(filters);
    sendTsRestSuccess(res, 200, { 
      success: true, // <-- ADDED
      message: 'Filtered events fetched successfully', 
      body: results 
    });
  });

  // -------- State changes --------
  publishEvent = tryCatchWrapper(async (req: Request, res: Response) => {
    const { id } = idParamSchema.parse(req.params);
    const published = await this.eventService.publishEvent(id);
    if (!published) {
      return sendTsRestError(res, 404, 'Event not found');
    }
    sendTsRestSuccess(res, 200, { 
      success: true, // <-- ADDED
      message: 'Event published successfully', 
      body: published 
    });
  });

  cancelEvent = tryCatchWrapper(async (req: Request, res: Response) => {
    const { id } = idParamSchema.parse(req.params);
    const cancelled = await this.eventService.cancelEvent(id);
    if (!cancelled) {
      return sendTsRestError(res, 404, 'Event not found');
    }
    sendTsRestSuccess(res, 200, { 
      success: true, // <-- ADDED
      message: 'Event cancelled successfully', 
      body: cancelled 
    });
  });

  postponeEvent = tryCatchWrapper(async (req: Request, res: Response) => {
    const { id } = idParamSchema.parse(req.params);
    const { newDate } = postponeEventSchema.parse(req.body);
    const postponed = await this.eventService.postponeEvent(id, newDate);
    if (!postponed) {
      return sendTsRestError(res, 404, 'Event not found');
    }
    sendTsRestSuccess(res, 200, { 
      success: true, // <-- ADDED
      message: 'Event postponed successfully', 
      body: postponed 
    });
  })};