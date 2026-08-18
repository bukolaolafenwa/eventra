const DAY_MS =
  24 * 60 * 60 * 1000

export const PAYOUT_DELAY_DAYS = 3

/**
 * Calculates when an event's earnings become eligible for payout.
 *
 * Multi-day events use endDate. Single-day events without an endDate
 * use startDate, ensuring they are not permanently excluded from payouts.
 */
export const getPayoutEligibleAt = (
  startDate: Date,
  endDate?: Date,
): Date => {
  const eventCompletionDate =
    endDate ?? startDate

  return new Date(
    eventCompletionDate.getTime() +
      PAYOUT_DELAY_DAYS * DAY_MS,
  )
}

/**
 * Checks whether the event has completed its payout holding period.
 * Equality is eligible: a payout may be initiated at the exact eligibleAt
 * timestamp or any time afterward.
 */
export const isPayoutEligible = (
  startDate: Date,
  endDate: Date | undefined,
  now: Date = new Date(),
): boolean =>
  now.getTime() >=
  getPayoutEligibleAt(
    startDate,
    endDate,
  ).getTime()