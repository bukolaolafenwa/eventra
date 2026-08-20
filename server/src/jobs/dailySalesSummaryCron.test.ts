import mongoose from 'mongoose'
import {
  MongoMemoryServer,
} from 'mongodb-memory-server'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import Event from '../models/event.js'
import Ticket from '../models/ticket.js'
import User from '../models/user.js'
import {
  getPreviousLagosCalendarDay,
  sendDailySalesSummaries,
} from './dailySalesSummaryCron.js'

const {
  sendDailySalesSummaryEmailMock,
} = vi.hoisted(() => ({
  sendDailySalesSummaryEmailMock:
    vi.fn(),
}))

vi.mock(
  '../services/email.service.js',
  () => ({
    EmailService: {
      sendDailySalesSummaryEmail:
        sendDailySalesSummaryEmailMock,
    },
  }),
)

let mongoServer: MongoMemoryServer

const NOW = new Date(
  '2026-08-20T06:00:00.000Z',
)

beforeAll(async () => {
  mongoServer =
    await MongoMemoryServer.create()

  await mongoose.connect(
    mongoServer.getUri(),
    {
      dbName:
        'eventra_daily_summary_test',
    },
  )

  await Promise.all([
    Event.init(),
    Ticket.init(),
    User.init(),
  ])
})

beforeEach(() => {
  sendDailySalesSummaryEmailMock
    .mockReset()
    .mockResolvedValue({
      success: true,
    })
})

afterEach(async () => {
  await Promise.all([
    Ticket.deleteMany({}),
    Event.deleteMany({}),
    User.deleteMany({}),
  ])
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongoServer.stop()
})

const createOrganizer = async (
  overrides: Record<
    string,
    unknown
  > = {},
) =>
  User.create({
    fullname: 'Test Organizer',
    email:
      `organizer-${new mongoose.Types.ObjectId()}@example.com`,
    password: 'password123',
    role: 'organizer',
    isVerified: true,
    isSuspended: false,
    organizerNotificationPreferences:
      {
        newTicketSalesAndRsvps:
          false,
        dailySalesSummary: true,
        payoutConfirmations: false,
        eventApprovals: false,
      },
    ...overrides,
  })

const createEvent = async (
  organizerId:
    mongoose.Types.ObjectId,
) =>
  Event.create({
    organizer: organizerId,
    title: 'Daily Summary Event',
    slug:
      `daily-summary-${new mongoose.Types.ObjectId()}`,
    description:
      'An event used to test daily sales summary delivery',
    category:
      new mongoose.Types.ObjectId(),
    type: 'paid',
    coverImage:
      'https://example.com/event.jpg',
    venue: {
      name: 'Test Hall',
      address: '1 Test Street',
      city: 'Lagos',
    },
    startDate: new Date(
      NOW.getTime() +
        7 * 24 * 60 * 60 * 1000,
    ),
    refundPolicy: {
      type: 'no-refunds',
    },
    status: 'approved',
  })

const createTicketAt = async (
  eventId:
    mongoose.Types.ObjectId,
  createdAt: Date,
  pricePaid = 5000,
) => {
  const ticket =
    await Ticket.create({
      order:
        new mongoose.Types.ObjectId(),
      ticketId:
        `TK_${new mongoose.Types.ObjectId()
          .toString()
          .toUpperCase()}`,
      sequence: 1,
      event: eventId,
      attendee:
        new mongoose.Types.ObjectId(),
      attendeeName:
        'Test Attendee',
      attendeeEmail:
        'attendee@example.com',
      attendeePhone:
        '08000000000',
      ticketTypeName: 'Regular',
      code:
        `EVT-${new mongoose.Types.ObjectId()
          .toString()
          .toUpperCase()}`,
      pricePaid,
      currency: 'NGN',
      status: 'active',
      issuedAt: createdAt,
    })

  // Force the reporting timestamp so the test does not depend on the
  // computer's actual clock.
  await Ticket.collection.updateOne(
    { _id: ticket._id },
    {
      $set: {
        createdAt,
        updatedAt: createdAt,
      },
    },
  )

  return ticket
}

describe(
  'getPreviousLagosCalendarDay',
  () => {
    it('returns the previous complete Lagos day as a UTC range', () => {
      const range =
        getPreviousLagosCalendarDay(
          NOW,
        )

      expect(
        range.periodKey,
      ).toBe('2026-08-19')

      expect(
        range.from.toISOString(),
      ).toBe(
        '2026-08-18T23:00:00.000Z',
      )

      expect(
        range.to.toISOString(),
      ).toBe(
        '2026-08-19T23:00:00.000Z',
      )
    })
  },
)

describe(
  'sendDailySalesSummaries',
  () => {
    it('sends one summary and does not resend the same reporting day', async () => {
      const organizer =
        await createOrganizer()

      const event =
        await createEvent(
          organizer._id,
        )

      await createTicketAt(
        event._id,
        new Date(
          '2026-08-19T10:00:00.000Z',
        ),
      )

      const firstRun =
        await sendDailySalesSummaries(
          NOW,
        )

      const secondRun =
        await sendDailySalesSummaries(
          NOW,
        )

      expect(firstRun.emailsSent).toBe(
        1,
      )
      expect(
        secondRun.emailsSent,
      ).toBe(0)

      expect(
        sendDailySalesSummaryEmailMock,
      ).toHaveBeenCalledTimes(1)

      const updatedOrganizer =
        await User.findById(
          organizer._id,
        )
          .select(
            '+organizerNotificationPreferences.dailySalesSummaryLastSentFor',
          )
          .lean()

      expect(
        updatedOrganizer!
          .organizerNotificationPreferences
          .dailySalesSummaryLastSentFor,
      ).toBe('2026-08-19')
    })

    it('releases the lease when email delivery fails so a retry can succeed', async () => {
      sendDailySalesSummaryEmailMock
        .mockResolvedValueOnce({
          success: false,
        })
        .mockResolvedValueOnce({
          success: true,
        })

      const organizer =
        await createOrganizer()

      const event =
        await createEvent(
          organizer._id,
        )

      await createTicketAt(
        event._id,
        new Date(
          '2026-08-19T12:00:00.000Z',
        ),
      )

      const firstRun =
        await sendDailySalesSummaries(
          NOW,
        )

      const retryRun =
        await sendDailySalesSummaries(
          NOW,
        )

      expect(firstRun.emailsSent).toBe(
        0,
      )
      expect(retryRun.emailsSent).toBe(
        1,
      )

      expect(
        sendDailySalesSummaryEmailMock,
      ).toHaveBeenCalledTimes(2)
    })

    it('does not send to an organizer who has opted out', async () => {
      const organizer =
        await createOrganizer({
          organizerNotificationPreferences:
            {
              newTicketSalesAndRsvps:
                false,
              dailySalesSummary:
                false,
              payoutConfirmations:
                false,
              eventApprovals: false,
            },
        })

      const event =
        await createEvent(
          organizer._id,
        )

      await createTicketAt(
        event._id,
        new Date(
          '2026-08-19T10:00:00.000Z',
        ),
      )

      const result =
        await sendDailySalesSummaries(
          NOW,
        )

      expect(result.emailsSent).toBe(
        0,
      )

      expect(
        sendDailySalesSummaryEmailMock,
      ).not.toHaveBeenCalled()
    })

    it('does not send to a suspended organizer', async () => {
      const organizer =
        await createOrganizer({
          isSuspended: true,
        })

      const event =
        await createEvent(
          organizer._id,
        )

      await createTicketAt(
        event._id,
        new Date(
          '2026-08-19T10:00:00.000Z',
        ),
      )

      const result =
        await sendDailySalesSummaries(
          NOW,
        )

      expect(result.emailsSent).toBe(
        0,
      )

      expect(
        sendDailySalesSummaryEmailMock,
      ).not.toHaveBeenCalled()
    })

    it('ignores tickets outside the reporting calendar day', async () => {
      const organizer =
        await createOrganizer()

      const event =
        await createEvent(
          organizer._id,
        )

      await createTicketAt(
        event._id,
        new Date(
          '2026-08-20T01:00:00.000Z',
        ),
      )

      const result =
        await sendDailySalesSummaries(
          NOW,
        )

      expect(result.emailsSent).toBe(
        0,
      )

      expect(
        sendDailySalesSummaryEmailMock,
      ).not.toHaveBeenCalled()
    })
  },
)