import mongoose from 'mongoose'
import Event from '../models/event.js'
import EventCategory from '../models/eventCategory.js'
import TicketType from '../models/ticketType.js'
import { generateUniqueSlug } from '../lib/utils.js'
import { ErrorResponse } from '../middlewares/error.middleware.js'


// Fields organizers are allowed to update.
// Anything outside this list is handled by dedicated actions.
const EDITABLE_FIELDS = [
  'title',
  'description',
  'date',
  'time',
  'venue',
  'location',
  'category',
  'capacity',
  'tags',
  'bannerImage',
  'galleryImages',
  'endDate',
  'endTime',
  'visibility',
] as const

type EditableField = (typeof EDITABLE_FIELDS)[number]


// Shared schedule structure used when validating event dates and times.
interface ScheduleInput {
  date?: string
  time?: string
  endDate?: string
  endTime?: string
}

export class EventService {
  /**
   * Create a new event after validating the schedule
   * and ensuring the selected category exists.
   */
  async create(data: {
    title: string;
    description: string;
    date: string;
    time: string;
    venue: string;
    location: string;
    category: string;
    capacity: number;
    tags?: string[];
    bannerImage?: string;
    galleryImages?: string[];
    endDate?: string;
    endTime?: string;
    visibility?: "public" | "private";
    organizer: string;
  }): Promise<Record<string, unknown>> {
    // Validate the event schedule before saving it.
    this.validateSchedule({
      date: data.date,
      time: data.time,
      endDate: data.endDate,
      endTime: data.endTime,
    });
    await this.validateCategoryExists(data.category);

    // Generate a unique slug so each event has a clean URL.
    const slug = await generateUniqueSlug(data.title, async (s: string) => {
      const existing = await Event.exists({ slug: s });
      return !!existing;
    });

    const event = await Event.create({
      ...data,
      slug,
      date: new Date(data.date),
      ...(data.endDate ? { endDate: new Date(data.endDate) } : {}),
    });

    return event.toObject();
  }

  /**
   * Update an existing event.
   * Only editable fields are allowed to be changed.
   */
  async update(
    eventId: string,
    organizerId: string,
    data: Partial<{
      title: string;
      description: string;
      date: string;
      time: string;
      venue: string;
      location: string;
      category: string;
      capacity: number;
      tags: string[];
      bannerImage: string;
      galleryImages: string[];
      endDate: string;
      endTime: string;
      visibility: "public" | "private";
    }>,
  ): Promise<Record<string, unknown> | null> {
    const event = await Event.findOne({
      _id: eventId,
      organizer: organizerId,
    }).lean();
    if (!event) {
      throw new ErrorResponse("Event not found", 404);
    }

    // Build an update object using only allowed fields.
    const updateData: Record<string, unknown> = {};

    for (const field of EDITABLE_FIELDS) {
      if (field in data) {
        updateData[field] = data[field];
      }
    }

    const hasScheduleChange =
      "date" in data ||
      "time" in data ||
      "endDate" in data ||
      "endTime" in data;
    if (hasScheduleChange) {
      this.validateSchedule({
        date:
          typeof data.date === "string" ? data.date : event.date.toISOString(),
        time: typeof data.time === "string" ? data.time : event.time,
        endDate:
          typeof data.endDate === "string"
            ? data.endDate
            : event.endDate?.toISOString(),
        endTime:
          typeof data.endTime === "string" ? data.endTime : event.endTime,
      });
    }

    if (
      typeof updateData.category === "string" &&
      updateData.category !== String(event.category)
    ) {
      await this.validateCategoryExists(updateData.category);
    }

    if (updateData.date) updateData.date = new Date(updateData.date as string);
    if (updateData.endDate)
      updateData.endDate = new Date(updateData.endDate as string);

    if (
      typeof updateData.title === "string" &&
      updateData.title !== event.title
    ) {
      updateData.slug = await generateUniqueSlug(
        updateData.title,
        async (s: string) => {
          const existing = await Event.exists({
            slug: s,
            _id: { $ne: eventId },
          });
          return !!existing;
        },
      );
    }

    const updated = await Event.findByIdAndUpdate(
      eventId,
      { $set: updateData },
      { new: true },
    ).lean();
    return updated;
  }

  /**
   * Delete an event.
   * Only draft events can be removed.
   */
  async delete(eventId: string, organizerId: string): Promise<void> {
    const event = await Event.findOne({
      _id: eventId,
      organizer: organizerId,
    }).lean();
    if (!event) {
      throw new ErrorResponse("Event not found", 404);
    }
    if (event.status !== "draft") {
      throw new ErrorResponse("Only draft events can be deleted", 400);
    }

    await Event.deleteOne({ _id: eventId });
    await TicketType.deleteMany({ event: eventId });
  }

  /**
   * Publish an event once it meets the minimum requirements.
   */
  async publish(
    eventId: string,
    organizerId: string,
  ): Promise<Record<string, unknown> | null> {
    const event = await Event.findOne({
      _id: eventId,
      organizer: organizerId,
    }).lean();
    if (!event) {
      throw new ErrorResponse("Event not found", 404);
    }
    if (event.status !== "draft") {
      throw new ErrorResponse("Only draft events can be published", 400);
    }

    this.validateSchedule({
      date: event.date.toISOString(),
      time: event.time,
      endDate: event.endDate ? event.endDate.toISOString() : undefined,
      endTime: event.endTime,
    });

    if (!event.bannerImage) {
      throw new ErrorResponse(
        "Event must have a banner image before it can be published",
        400,
      );
    }

    // Make sure there's at least one ticket users can buy.
    const activeTicketTypeCount = await TicketType.countDocuments({
      event: eventId,
      isActive: true,
      remaining: { $gt: 0 },
    });
    if (activeTicketTypeCount === 0) {
      throw new ErrorResponse(
        "Event must have at least one active ticket type with available tickets before it can be published",
        400,
      );
    }

    const published = await Event.findOneAndUpdate(
      { _id: eventId, status: "draft" },
      { $set: { status: "published" } },
      { new: true },
    ).lean();

    if (!published) {
      throw new ErrorResponse("Event not found or cannot be published", 400);
    }
    return published;
  }

  /**
   * Move a published event back to draft.
   */
  async draft(
    eventId: string,
    organizerId: string,
  ): Promise<Record<string, unknown> | null> {
    const event = await Event.findOneAndUpdate(
      { _id: eventId, organizer: organizerId, status: "published" },
      { $set: { status: "draft" } },
      { new: true },
    ).lean();
    if (!event) {
      throw new ErrorResponse(
        "Event not found or cannot be reverted to draft",
        400,
      );
    }
    return event;
  }

  /**
   * Cancel an event that is still active.
   */
  async cancel(
    eventId: string,
    organizerId: string,
  ): Promise<Record<string, unknown> | null> {
    const event = await Event.findOneAndUpdate(
      {
        _id: eventId,
        organizer: organizerId,
        status: { $in: ["draft", "published"] },
      },
      { $set: { status: "cancelled" } },
      { new: true },
    ).lean();
    if (!event) {
      throw new ErrorResponse("Event not found or cannot be cancelled", 400);
    }
    return event;
  }

  /**
   * Update an event's schedule while keeping it valid.
   */
  async postponeEvent(
    eventId: string,
    organizerId: string,
    data: { date: string; time: string; endDate?: string; endTime?: string },
  ): Promise<Record<string, unknown> | null> {
    const event = await Event.findOne({
      _id: eventId,
      organizer: organizerId,
    }).lean();
    if (!event) {
      throw new ErrorResponse("Event not found", 404);
    }
    if (event.status === "cancelled") {
      throw new ErrorResponse("Cancelled events cannot be postponed", 400);
    }

    this.validateSchedule(data);

    const newDate = new Date(data.date);
    const existingEndDate = event.endDate ? new Date(event.endDate) : undefined;

    let nextEndDate: Date | undefined;
    let nextEndTime: string | undefined;

    if (data.endDate) {
      nextEndDate = new Date(data.endDate);
      nextEndTime = data.endTime;
    } else if (
      existingEndDate &&
      existingEndDate.getTime() >= newDate.getTime()
    ) {
      nextEndDate = existingEndDate;
      nextEndTime = event.endTime;
    }

    const setData: Record<string, unknown> = { date: newDate, time: data.time };

    // Remove old schedule fields that are no longer needed.
    const unsetData: Record<string, 1> = {};

    if (nextEndDate) {
      setData.endDate = nextEndDate;
      if (nextEndTime) {
        setData.endTime = nextEndTime;
      } else {
        unsetData.endTime = 1;
      }
    } else {
      unsetData.endDate = 1;
      unsetData.endTime = 1;
    }

    const updateDoc: Record<string, unknown> = { $set: setData };
    if (Object.keys(unsetData).length > 0) {
      updateDoc.$unset = unsetData;
    }

    const updated = await Event.findByIdAndUpdate(eventId, updateDoc, {
      new: true,
    }).lean();
    return updated;
  }

  /**
   * Return a public event using its slug.
   */
  async getBySlug(slug: string): Promise<Record<string, unknown> | null> {
    return Event.findOne({
      slug,
      status: "published",
      visibility: "public",
    }).lean();
  }

  /**
   * Get paginated events for a specific organizer.
   */
  async getOrganizerEvents(
    organizerId: string,
    options: { page: number; limit: number; status?: string },
  ): Promise<{
    events: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
  }> {
    const query: Record<string, unknown> = { organizer: organizerId };
    if (options.status) {
      query.status = options.status;
    }

    const [events, total] = await Promise.all([
      Event.find(query)
        .sort({ createdAt: -1 })
        .skip((options.page - 1) * options.limit)
        .limit(options.limit)
        .lean(),
      Event.countDocuments(query),
    ]);

    return { events, total, page: options.page, limit: options.limit };
  }

  /**
   * Return public events with search, filters and pagination.
   */
  async listPublic(options: {
    page: number;
    limit: number;
    search?: string;
    category?: string;
    status?: string;
    sort?: string;
    tags?: string[];
  }): Promise<{
    events: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
  }> {
    // Only published public events should be visible here.
    const query: Record<string, unknown> = {
      status: "published",
      visibility: "public",
    };

    if (options.search) {
      query.$text = { $search: options.search };
    }
    if (options.category) {
      query.category = options.category;
    }
    if (options.tags && options.tags.length > 0) {
      query.tags = { $in: options.tags };
    }

    let sortOption: Record<string, 1 | -1> = { date: 1 };
    if (options.sort === "date_desc") sortOption = { date: -1 };
    else if (options.sort === "date_asc") sortOption = { date: 1 };
    else if (options.sort === "title") sortOption = { title: 1 };
    else if (options.sort === "newest") sortOption = { createdAt: -1 };
    else if (options.sort === "popular") sortOption = { createdAt: -1 };

    const skip = (options.page - 1) * options.limit;

    const [events, total] = await Promise.all([
      Event.find(query).sort(sortOption).skip(skip).limit(options.limit).lean(),
      Event.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / options.limit);

    return {
      events,
      total,
      page: options.page,
      limit: options.limit,
      totalPages,
      hasMore: options.page < totalPages,
    };
  }

  async getCategories(): Promise<Record<string, unknown>[]> {
    return EventCategory.find().sort({ name: 1 }).lean();
  }

  // Convert a time string into hours and minutes.
  private parseTime(time: string): { hours: number; minutes: number } | null {
    const match = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(
      time.trim(),
    );
    if (!match) return null;
    return { hours: Number(match[1]), minutes: Number(match[2]) };
  }

  // Check that the event schedule is valid before saving.
  private validateSchedule(data: ScheduleInput): void {
    const hasDate = typeof data.date === "string";
    const hasEndDate = typeof data.endDate === "string";
    const hasTime = typeof data.time === "string";
    const hasEndTime = typeof data.endTime === "string";

    if (hasDate && Number.isNaN(new Date(data.date as string).getTime())) {
      throw new ErrorResponse("Invalid event date", 400);
    }
    if (
      hasEndDate &&
      Number.isNaN(new Date(data.endDate as string).getTime())
    ) {
      throw new ErrorResponse("Invalid event end date", 400);
    }
    if (hasTime && !this.parseTime(data.time as string)) {
      throw new ErrorResponse("Invalid event time. Expected format HH:MM", 400);
    }
    if (hasEndTime && !this.parseTime(data.endTime as string)) {
      throw new ErrorResponse(
        "Invalid event end time. Expected format HH:MM",
        400,
      );
    }
    if (hasEndTime && !hasEndDate) {
      throw new ErrorResponse(
        "End time cannot be set without an end date",
        400,
      );
    }

    if (hasDate && hasEndDate) {
      const start = new Date(data.date as string);
      const end = new Date(data.endDate as string);
      if (end.getTime() < start.getTime()) {
        throw new ErrorResponse(
          "Event end date must not be before the event date",
          400,
        );
      }
      if (
        start.toDateString() === end.toDateString() &&
        hasTime &&
        hasEndTime
      ) {
        const startTime = this.parseTime(data.time as string);
        const endTime = this.parseTime(data.endTime as string);
        if (
          startTime &&
          endTime &&
          endTime.hours * 60 + endTime.minutes <=
            startTime.hours * 60 + startTime.minutes
        ) {
          throw new ErrorResponse(
            "Event end time must be after the event start time",
            400,
          );
        }
      }
    }
  }

  // Ensure the selected category exists before using it.
  private async validateCategoryExists(categoryId: string): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      throw new ErrorResponse("Invalid event category", 400);
    }
    const categoryExists = await EventCategory.exists({ _id: categoryId });
    if (!categoryExists) {
      throw new ErrorResponse("Invalid event category", 400);
    }
  }
}

export const eventService = new EventService()
