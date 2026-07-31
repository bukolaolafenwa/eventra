import { CreateEventInput, UpdateEventInput, Event, EventFilters } from '../types/event.types.js';

// In-memory store (simulate DB)
let events: Event[] = [];
let idCounter = 1;

export class EventService {
  async createEvent(data: CreateEventInput): Promise<Event> {
    const newEvent: Event = {
      id: String(idCounter++),
      ...data,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    events.push(newEvent);
    return newEvent;
  }

  async getEvents(page: number, limit: number): Promise<{ items: Event[]; total: number; page: number; limit: number }> {
    const start = (page - 1) * limit;
    const paginated = events.slice(start, start + limit);
    return {
      items: paginated,
      total: events.length,
      page,
      limit,
    };
  }

  async getEventById(id: string): Promise<Event | null> {
    return events.find(e => e.id === id) || null;
  }

  async updateEvent(id: string, data: UpdateEventInput): Promise<Event | null> {
    const index = events.findIndex(e => e.id === id);
    if (index === -1) return null;
    const updated = { ...events[index], ...data, updatedAt: new Date().toISOString() };
    events[index] = updated;
    return updated;
  }

  async deleteEvent(id: string): Promise<boolean> {
    const index = events.findIndex(e => e.id === id);
    if (index === -1) return false;
    events.splice(index, 1);
    return true;
  }

  async searchEvents(query: string): Promise<Event[]> {
    const lower = query.toLowerCase();
    return events.filter(e =>
      e.title.toLowerCase().includes(lower) ||
      (e.description && e.description.toLowerCase().includes(lower))
    );
  }

  async filterEvents(filters: EventFilters): Promise<Event[]> {
    return events.filter(e => {
      if (filters.startDate && new Date(e.date) < new Date(filters.startDate)) return false;
      if (filters.endDate && new Date(e.date) > new Date(filters.endDate)) return false;
      if (filters.location && e.location !== filters.location) return false;
      if (filters.minPrice !== undefined && (e.price ?? 0) < filters.minPrice) return false;
      if (filters.maxPrice !== undefined && (e.price ?? 0) > filters.maxPrice) return false;
      return true;
    });
  }

  async publishEvent(id: string): Promise<Event | null> {
    const event = await this.getEventById(id);
    if (!event) return null;
    if (event.status === 'cancelled') throw new Error('Cannot publish a cancelled event');
    return this.updateEvent(id, { ...event, status: 'published' });
  }

  async cancelEvent(id: string): Promise<Event | null> {
    const event = await this.getEventById(id);
    if (!event) return null;
    if (event.status === 'published') throw new Error('Cannot cancel a published event (you may refund tickets)');
    return this.updateEvent(id, { ...event, status: 'cancelled' });
  }

  async postponeEvent(id: string, newDate: string): Promise<Event | null> {
    const event = await this.getEventById(id);
    if (!event) return null;
    if (event.status === 'cancelled') throw new Error('Cannot postpone a cancelled event');
    return this.updateEvent(id, { ...event, date: newDate, status: 'postponed' });
  }
}