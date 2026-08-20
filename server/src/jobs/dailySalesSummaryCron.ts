import mongoose from 'mongoose'
import logger from '../config/logger.js'
import Event from '../models/event.js'
import Ticket from '../models/ticket.js'
import User from '../models/user.js'
import { EmailService } from '../services/email.service.js'

const DAY_MS =
  24 * 60 * 60 * 1000

const LAGOS_UTC_OFFSET_MS =
  60 * 60 * 1000

const DELIVERY_LEASE_MS =
  30 * 60 * 1000

interface CalendarDayRange {
  from: Date
  to: Date
  periodKey: string
}

interface SalesAggregateRow {
  _id: mongoose.Types.ObjectId
  ticketsSold: number
  revenue: number
}

/**
 * Returns the previous complete Lagos calendar day as a UTC range.
 *
 * Lagos is permanently UTC+1 and does not observe daylight saving time.
 * For example, a run on 20 August reports sales from 00:00 through 23:59
 * WAT on 19 August rather than using an overlapping rolling 24-hour window.
 */
export const getPreviousLagosCalendarDay =
  (
    now: Date = new Date(),
  ): CalendarDayRange => {
    const lagosNow =
      new Date(
        now.getTime() +
          LAGOS_UTC_OFFSET_MS,
      )

    const startOfTodayUtcMs =
      Date.UTC(
        lagosNow.getUTCFullYear(),
        lagosNow.getUTCMonth(),
        lagosNow.getUTCDate(),
      ) - LAGOS_UTC_OFFSET_MS

    const to =
      new Date(startOfTodayUtcMs)

    const from =
      new Date(
        startOfTodayUtcMs -
          DAY_MS,
      )

    const periodKey =
      new Date(
        from.getTime() +
          LAGOS_UTC_OFFSET_MS,
      )
        .toISOString()
        .slice(0, 10)

    return {
      from,
      to,
      periodKey,
    }
  }

const dateLabelFor = (
  date: Date,
): string =>
  date.toLocaleDateString(
    'en-NG',
    {
      dateStyle: 'medium',
      timeZone: 'Africa/Lagos',
    },
  )

/**
 * Emails opted-in organizers a summary for the previous Lagos calendar
 * day. A short database lease prevents simultaneous cron invocations from
 * sending duplicate emails, while failed delivery releases the lease so a
 * later retry can try again.
 */
export const sendDailySalesSummaries =
  async (
    now: Date = new Date(),
  ): Promise<{
    periodKey: string
    organizersChecked: number
    emailsSent: number
  }> => {
    const {
      from,
      to,
      periodKey,
    } =
      getPreviousLagosCalendarDay(
        now,
      )

    const staleLeaseBefore =
      new Date(
        now.getTime() -
          DELIVERY_LEASE_MS,
      )

    const organizers =
      await User.find({
        role: 'organizer',
        isSuspended: {
          $ne: true,
        },
        'organizerNotificationPreferences.dailySalesSummary':
          true,
        'organizerNotificationPreferences.dailySalesSummaryLastSentFor':
          {
            $ne: periodKey,
          },
      }).select(
        '_id fullname email',
      )

    let emailsSent = 0

    for (
      const organizer of
      organizers
    ) {
      let leaseAcquired = false

      const releaseLease =
        async (): Promise<void> => {
          await User.updateOne(
            {
              _id: organizer._id,
              'organizerNotificationPreferences.dailySalesSummarySendingFor':
                periodKey,
            },
            {
              $unset: {
                'organizerNotificationPreferences.dailySalesSummarySendingFor':
                  1,
                'organizerNotificationPreferences.dailySalesSummarySendingAt':
                  1,
              },
            },
          )
        }

      try {
        const events =
          await Event.find({
            organizer:
              organizer._id,
          })
            .select('title')
            .lean()

        if (events.length === 0) {
          continue
        }

        const eventIds =
          events.map(
            event => event._id,
          )

        const titleById =
          new Map(
            events.map(
              event => [
                event._id.toString(),
                event.title,
              ],
            ),
          )

        const perEvent =
          await Ticket.aggregate<SalesAggregateRow>(
            [
              {
                $match: {
                  event: {
                    $in: eventIds,
                  },
                  createdAt: {
                    $gte: from,
                    $lt: to,
                  },

                  // Cancelled and refunded admissions are not counted as
                  // completed sales or active RSVPs in the daily digest.
                  status: {
                    $in: [
                      'active',
                      'used',
                    ],
                  },
                },
              },
              {
                $group: {
                  _id: '$event',
                  ticketsSold: {
                    $sum: 1,
                  },
                  revenue: {
                    $sum: '$pricePaid',
                  },
                },
              },
            ],
          )

        if (
          perEvent.length === 0
        ) {
          continue
        }

        /*
         * Acquire the delivery lease only after confirming that there is
         * something to send. A stale lease may be reclaimed after thirty
         * minutes if a previous process stopped unexpectedly.
         */
        const claim =
          await User.updateOne(
            {
              _id: organizer._id,
              'organizerNotificationPreferences.dailySalesSummary':
                true,
              'organizerNotificationPreferences.dailySalesSummaryLastSentFor':
                {
                  $ne: periodKey,
                },
              $or: [
                {
                  'organizerNotificationPreferences.dailySalesSummarySendingAt':
                    {
                      $exists: false,
                    },
                },
                {
                  'organizerNotificationPreferences.dailySalesSummarySendingAt':
                    {
                      $lt: staleLeaseBefore,
                    },
                },
              ],
            },
            {
              $set: {
                'organizerNotificationPreferences.dailySalesSummarySendingFor':
                  periodKey,
                'organizerNotificationPreferences.dailySalesSummarySendingAt':
                  now,
              },
            },
          )

        if (
          claim.modifiedCount !== 1
        ) {
          continue
        }

        leaseAcquired = true

        const rows =
          perEvent
            .map(row => ({
              eventTitle:
                titleById.get(
                  row._id.toString(),
                ) ??
                'Untitled event',
              ticketsSold:
                row.ticketsSold,
              revenueLabel:
                row.revenue > 0
                  ? `₦${row.revenue.toLocaleString(
                      'en-NG',
                    )}`
                  : 'Free RSVP',
            }))
            .sort(
              (a, b) =>
                b.ticketsSold -
                a.ticketsSold,
            )

        const totalRevenue =
          perEvent.reduce(
            (sum, row) =>
              sum + row.revenue,
            0,
          )

        const totalRevenueLabel =
          totalRevenue > 0
            ? `₦${totalRevenue.toLocaleString(
                'en-NG',
              )}`
            : 'Free RSVPs only'

        const delivery =
          await EmailService
            .sendDailySalesSummaryEmail(
              organizer,
              dateLabelFor(from),
              rows,
              totalRevenueLabel,
            )

        if (!delivery.success) {
          await releaseLease()
          leaseAcquired = false

          logger.warn(
            {
              organizerId:
                organizer._id,
              periodKey,
            },
            'Daily sales summary email was not accepted for delivery',
          )

          continue
        }

        await User.updateOne(
          {
            _id: organizer._id,
            'organizerNotificationPreferences.dailySalesSummarySendingFor':
              periodKey,
          },
          {
            $set: {
              'organizerNotificationPreferences.dailySalesSummaryLastSentFor':
                periodKey,
            },
            $unset: {
              'organizerNotificationPreferences.dailySalesSummarySendingFor':
                1,
              'organizerNotificationPreferences.dailySalesSummarySendingAt':
                1,
            },
          },
        )

        leaseAcquired = false
        emailsSent++
      } catch (error: unknown) {
        if (leaseAcquired) {
          try {
            await releaseLease()
          } catch (
            releaseError: unknown
          ) {
            logger.error(
              {
                err: releaseError,
                organizerId:
                  organizer._id,
                periodKey,
              },
              'Could not release daily sales summary delivery lease',
            )
          }
        }

        logger.error(
          {
            err: error,
            organizerId:
              organizer._id,
            periodKey,
          },
          'Daily sales summary failed for organizer',
        )
      }
    }

    logger.info(
      {
        periodKey,
        organizersChecked:
          organizers.length,
        emailsSent,
      },
      'Daily sales summary cron completed',
    )

    return {
      periodKey,
      organizersChecked:
        organizers.length,
      emailsSent,
    }
  }