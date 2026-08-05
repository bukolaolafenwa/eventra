import Event, { type IEvent } from '../models/event.js'
import { generateSlug } from '../utils/slug.js'
import type { CreateEventInput } from '../types/event.types.js'

/* -------------------------------------------------------------------------- */
/*                               Private Helpers                              */
/* -------------------------------------------------------------------------- */

/**
 * Generates a unique slug for an event.
 */
const generateUniqueSlug = async (title: string): Promise<string> => {
  const baseSlug = generateSlug(title)

  let slug = baseSlug
  let counter = 1

  while (await Event.exists({ slug })) {
    slug = `${baseSlug}-${counter}`
    counter++
  }

  return slug
}

/* -------------------------------------------------------------------------- */
/*                              Public Services                               */
/* -------------------------------------------------------------------------- */

/**
 * Creates a new event.
 *
 * Responsibilities:
 * - Generate a unique slug
 * - Associate the event with the organizer
 * - Persist the event
 */
export const createEvent = async (
  organizerId: string,
  payload: CreateEventInput
): Promise<IEvent> => {
  const slug = await generateUniqueSlug(payload.title)

  const eventData = {
    organizer: organizerId,
    slug,
    ...payload,
  }

  const event = await Event.create(eventData)

  return event
}