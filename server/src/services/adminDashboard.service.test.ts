import { describe, expect, it } from 'vitest'
import { normalizeDashboardRange } from './adminDashboard.service.js'

describe('normalizeDashboardRange', () => {
  it('defaults to the seven-day dashboard range', () => {
    expect(normalizeDashboardRange(undefined)).toBe('7d')
  })

  it.each(['7d', '30d', '1y'] as const)('accepts %s', range => {
    expect(normalizeDashboardRange(range)).toBe(range)
  })

  it('rejects unsupported ranges', () => {
    expect(() => normalizeDashboardRange('90d')).toThrow(
      /range must be one of 7d, 30d or 1y/i,
    )
  })
})
