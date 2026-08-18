import {
  describe,
  expect,
  it,
} from 'vitest'

import {
  organizerNotificationPreferencesSchema,
} from './schemaValidation.js'

describe(
  'organizerNotificationPreferencesSchema',
  () => {
    it('accepts a partial notification update', () => {
      const result =
        organizerNotificationPreferencesSchema.safeParse(
          {
            payoutConfirmations: true,
          },
        )

      expect(result.success).toBe(true)
    })

    it('rejects an empty update', () => {
      const result =
        organizerNotificationPreferencesSchema.safeParse(
          {},
        )

      expect(result.success).toBe(false)
    })

    it('rejects unknown notification fields', () => {
      const result =
        organizerNotificationPreferencesSchema.safeParse(
          {
            payoutConfirmations: true,
            unknownPreference: true,
          },
        )

      expect(result.success).toBe(false)
    })
  },
)