import { Request, Response, NextFunction } from 'express';
import { EventService } from '../services/event.service.js';  
import { CreateEventInput, UpdateEventInput, EventFilters } from '../types/event.types.js';
import { validate } from '../utils/validation.js'; 
import { z } from 'zod';

// --- Validation Schemas (using Zod) ---
const createEventSchema = z.object({
  title: z.string().min(3).max(100),           // fixed: added ()
  description: z.string().optional(),
  date: z.string().datetime(),
  location: z.string().optional(),
  capacity: z.number().int().positive().optional(), // fixed: added ()
  price: z.number().nonnegative().optional(),
});

const updateEventSchema = z.object({
  title: z.string().min(3).max(100).optional(),
  description: z.string().optional(),
  date: z.string().datetime().optional(),
  location: z.string().optional(),
  capacity: z.number().int().positive().optional(),
  price: z.number().nonnegative().optional(),
  status: z.enum(['published', 'cancelled', 'postponed'])
});

const idParamsSchema = z.object({
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

export class EventController {
  constructor(private eventService: EventService) {}

  private sendSuccess(res: Response, statusCode: number, data: any) {
    return res.status(statusCode).json({
      success: true,
      data,
      error: null,
    });
  }

  private sendError(res: Response, statusCode: number, message: string) {
    return res.status(statusCode).json({
      success: false,
      data: null,
      error: message,
    });
  }

  createEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedData = validate<CreateEventInput>(createEventSchema, req.body);
      const event = await this.eventService.createEvent(validatedData);
      this.sendSuccess(res, 201, event);
    } catch (error) {
      next(error);
    }
  };

  getEvents = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const result = await this.eventService.getEvents(page, limit);
      this.sendSuccess(res, 200, result);
    } catch (error) {
      next(error);
    }
  };

  getEventById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = validate<{ id: string }>(idParamsSchema, req.params);
      const event = await this.eventService.getEventById(id);
      if (!event) {
        return this.sendError(res, 404, 'Event not found');
      }
      this.sendSuccess(res, 200, event);
    } catch (error) {
      next(error);
    }
  };

  updateEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = validate<{ id: string }>(idParamsSchema, req.params);
      const validatedData = validate<UpdateEventInput>(updateEventSchema, req.body);
      const updated = await this.eventService.updateEvent(id, validatedData);
      if (!updated) {
        return this.sendError(res, 404, 'Event not found');
      }
      this.sendSuccess(res, 200, updated);
    } catch (error) {
      next(error);
    }
  };

  deleteEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = validate<{ id: string }>(idParamsSchema, req.params);
      const deleted = await this.eventService.deleteEvent(id);
      if (!deleted) {
        return this.sendError(res, 404, 'Event not found');
      }
      this.sendSuccess(res, 200, { message: 'Event deleted successfully' });
    } catch (error) {
      next(error);
    }
  };

  searchEvents = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { q } = validate<{ q: string }>(searchQuerySchema, req.query);
      const results = await this.eventService.searchEvents(q);
      this.sendSuccess(res, 200, results);
    } catch (error) {
      next(error);
    }
  };

  filterEvents = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filters = validate<EventFilters>(filterQuerySchema, req.query);
      const results = await this.eventService.filterEvents(filters);
      this.sendSuccess(res, 200, results);
    } catch (error) {
      next(error);
    }
  };

  publishEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = validate<{ id: string }>(idParamsSchema, req.params);
      const published = await this.eventService.publishEvent(id);
      if (!published) {
        return this.sendError(res, 404, 'Event not found');
      }
      this.sendSuccess(res, 200, published);
    } catch (error) {
      next(error);
    }
  };

  cancelEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = validate<{ id: string }>(idParamsSchema, req.params);
      const cancelled = await this.eventService.cancelEvent(id);
      if (!cancelled) {
        return this.sendError(res, 404, 'Event not found');
      }
      this.sendSuccess(res, 200, cancelled);
    } catch (error) {
      next(error);
    }
  };

  postponeEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = validate<{ id: string }>(idParamsSchema, req.params);
      const { newDate } = req.body;
      if (!newDate || typeof newDate !== 'string') {
        return this.sendError(res, 400, 'newDate is required and must be a string');
      }
      const postponed = await this.eventService.postponeEvent(id, newDate);
      if (!postponed) {
        return this.sendError(res, 404, 'Event not found');
      }
      this.sendSuccess(res, 200, postponed);
    } catch (error) {
      next(error);
    }
  };
}