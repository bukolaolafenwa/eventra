import {
  describe,
  expect,
  it,
} from 'vitest'

import {
  getPayoutEligibleAt,
  isPayoutEligible,
  PAYOUT_DELAY_DAYS,
} from './payoutPolicy.js'

describe('payout policy', () => {
  it('uses a three-calendar-day holding period', () => {
    expect(PAYOUT_DELAY_DAYS).toBe(3)
  })

  it('calculates eligibility from the event end date', () => {
    const startDate = new Date(
      '2026-08-10T12:00:00.000Z',
    )
    const endDate = new Date(
      '2026-08-10T18:00:00.000Z',
    )

    expect(
      getPayoutEligibleAt(
        startDate,
        endDate,
      ).toISOString(),
    ).toBe('2026-08-13T18:00:00.000Z')
  })

  it('uses startDate when endDate is absent', () => {
    const startDate = new Date(
      '2026-08-10T18:00:00.000Z',
    )

    expect(
      getPayoutEligibleAt(
        startDate,
      ).toISOString(),
    ).toBe('2026-08-13T18:00:00.000Z')
  })

  it('rejects payout before the holding period ends', () => {
    const eventDate = new Date(
      '2026-08-10T18:00:00.000Z',
    )
    const now = new Date(
      '2026-08-13T17:59:59.999Z',
    )

    expect(
      isPayoutEligible(
        eventDate,
        undefined,
        now,
      ),
    ).toBe(false)
  })

  it('allows payout at the exact eligibility time', () => {
    const eventDate = new Date(
      '2026-08-10T18:00:00.000Z',
    )
    const now = new Date(
      '2026-08-13T18:00:00.000Z',
    )

    expect(
      isPayoutEligible(
        eventDate,
        undefined,
        now,
      ),
    ).toBe(true)
  })
})