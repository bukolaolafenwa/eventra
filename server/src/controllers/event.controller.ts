import { Request, Response, NextFunction } from 'express';
import { validate } from '../utils/validation.js';
import { z } from 'zod';
import { CreateEventInput, UpdateEventInput, EventFilters, Event } from '../types/event.types.js';

// --- In-memory data store (simulate database) ---
let events: Event[] = [];
let idCounter = 1;

// --- Validation Schemas ---
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
  id: z.string().uuid(), // or z.string() if you use numeric IDs
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
  // --- Helper: send success response ---
  private sendSuccess(res: Response, statusCode: number, data: any) {
    return res.status(statusCode).json({
      success: true,
      data,
      error: null,
    });
  }

  // --- Helper: send error response ---
  private sendError(res: Response, statusCode: number, message: string) {
    return res.status(statusCode).json({
      success: false,
      data: null,
      error: message,
    });
  }

  // -------- CRUD operations --------

  createEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedData = validate<CreateEventInput>(createEventSchema, req.body);
      const newEvent: Event = {
        id: String(idCounter++),
        ...validatedData,
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      events.push(newEvent);
      this.sendSuccess(res, 201, newEvent);
    } catch (error) {
      next(error);
    }
  };

  getEvents = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const start = (page - 1) * limit;
      const paginated = events.slice(start, start + limit);
      const result = {
        items: paginated,
        total: events.length,
        page,
        limit,
      };
      this.sendSuccess(res, 200, result);
    } catch (error) {
      next(error);
    }
  };

  getEventById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = validate<{ id: string }>(idParamSchema, req.params);
      const event = events.find(e => e.id === id);
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
      const { id } = validate<{ id: string }>(idParamSchema, req.params);
      const validatedData = validate<UpdateEventInput>(updateEventSchema, req.body);
      const index = events.findIndex(e => e.id === id);
      if (index === -1) {
        return this.sendError(res, 404, 'Event not found');
      }
      const updated = {
        ...events[index],
        ...validatedData,
        updatedAt: new Date().toISOString(),
      };
      events[index] = updated;
      this.sendSuccess(res, 200, updated);
    } catch (error) {
      next(error);
    }
  };

  deleteEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = validate<{ id: string }>(idParamSchema, req.params);
      const index = events.findIndex(e => e.id === id);
      if (index === -1) {
        return this.sendError(res, 404, 'Event not found');
      }
      events.splice(index, 1);
      this.sendSuccess(res, 200, { message: 'Event deleted successfully' });
    } catch (error) {
      next(error);
    }
  };

  // -------- Search & Filter --------

  searchEvents = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { q } = validate<{ q: string }>(searchQuerySchema, req.query);
      const lower = q.toLowerCase();
      const results = events.filter(e =>
        e.title.toLowerCase().includes(lower) ||
        (e.description && e.description.toLowerCase().includes(lower))
      );
      this.sendSuccess(res, 200, results);
    } catch (error) {
      next(error);
    }
  };

  filterEvents = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filters = validate<EventFilters>(filterQuerySchema, req.query);
      const results = events.filter(e => {
        if (filters.startDate && new Date(e.date) < new Date(filters.startDate)) return false;
        if (filters.endDate && new Date(e.date) > new Date(filters.endDate)) return false;
        if (filters.location && e.location !== filters.location) return false;
        if (filters.minPrice !== undefined && (e.price ?? 0) < filters.minPrice) return false;
        if (filters.maxPrice !== undefined && (e.price ?? 0) > filters.maxPrice) return false;
        return true;
      });
      this.sendSuccess(res, 200, results);
    } catch (error) {
      next(error);
    }
  };

  // -------- State changes --------

  publishEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = validate<{ id: string }>(idParamSchema, req.params);
      const index = events.findIndex(e => e.id === id);
      if (index === -1) {
        return this.sendError(res, 404, 'Event not found');
      }
      const event = events[index];
      if (event.status === 'cancelled') {
        throw new Error('Cannot publish a cancelled event');
      }
      event.status = 'published';
      event.updatedAt = new Date().toISOString();
      events[index] = event;
      this.sendSuccess(res, 200, event);
    } catch (error) {
      next(error);
    }
  };

  cancelEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = validate<{ id: string }>(idParamSchema, req.params);
      const index = events.findIndex(e => e.id === id);
      if (index === -1) {
        return this.sendError(res, 404, 'Event not found');
      }
      const event = events[index];
      if (event.status === 'published') {
        throw new Error('Cannot cancel a published event (you may refund tickets)');
      }
      event.status = 'cancelled';
      event.updatedAt = new Date().toISOString();
      events[index] = event;
      this.sendSuccess(res, 200, event);
    } catch (error) {
      next(error);
    }
  };

  postponeEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = validate<{ id: string }>(idParamSchema, req.params);
      const { newDate } = req.body;
      if (!newDate || typeof newDate !== 'string') {
        return this.sendError(res, 400, 'newDate is required and must be a string');
      }
      const index = events.findIndex(e => e.id === id);
      if (index === -1) {
        return this.sendError(res, 404, 'Event not found');
      }
      const event = events[index];
      if (event.status === 'cancelled') {
        throw new Error('Cannot postpone a cancelled event');
      }
      event.date = newDate;
      event.status = 'postponed';
      event.updatedAt = new Date().toISOString();
      events[index] = event;
      this.sendSuccess(res, 200, event);
    } catch (error) {
      next(error);
    }
  };
}