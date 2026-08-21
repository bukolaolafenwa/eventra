import { describe, expect, it } from 'vitest'
import {
  normalizeDashboardPeriod,
  normalizeDashboardRange,
} from './adminDashboard.service.js'

describe('normalizeDashboardPeriod', () => {
  it('defaults to the seven-day dashboard period', () => {
    expect(
      normalizeDashboardPeriod(
        undefined,
        undefined,
      ),
    ).toBe('7d')
  })

  it.each(['7d', '30d', '12m'] as const)(
    'accepts period=%s',
    period => {
      expect(
        normalizeDashboardPeriod(
          period,
          undefined,
        ),
      ).toBe(period)
    },
  )

  it.each(['7d', '30d'] as const)(
    'accepts legacy range=%s',
    range => {
      expect(
        normalizeDashboardPeriod(
          undefined,
          range,
        ),
      ).toBe(range)
    },
  )

  it('maps legacy range=1y to 12m', () => {
    expect(
      normalizeDashboardPeriod(
        undefined,
        '1y',
      ),
    ).toBe('12m')
  })

  it('accepts range=12m during migration', () => {
    expect(
      normalizeDashboardPeriod(
        undefined,
        '12m',
      ),
    ).toBe('12m')
  })

  it('rejects unsupported periods', () => {
    expect(() =>
      normalizeDashboardPeriod(
        '90d',
        undefined,
      ),
    ).toThrow(
      /period must be one of 7d, 30d or 12m/i,
    )
  })

  it('rejects period=1y because it is a legacy range value', () => {
    expect(() =>
      normalizeDashboardPeriod(
        '1y',
        undefined,
      ),
    ).toThrow(
      /period must be one of 7d, 30d or 12m/i,
    )
  })

  it('rejects period and range together', () => {
    expect(() =>
      normalizeDashboardPeriod(
        '30d',
        '30d',
      ),
    ).toThrow(
      /use either period or range, not both/i,
    )
  })
})

describe('normalizeDashboardRange', () => {
  it('preserves the legacy helper', () => {
    expect(
      normalizeDashboardRange('1y'),
    ).toBe('12m')
  })
})