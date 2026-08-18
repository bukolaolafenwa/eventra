import {
  describe,
  expect,
  it,
} from 'vitest'

import {
  sanitizeOrganizerProfile,
  sanitizeUser,
} from './utils.js'

describe(
  'organizer response sanitization',
  () => {
    it('masks an organizer bank account and removes the recipient code', () => {
      const result =
        sanitizeOrganizerProfile({
          businessName: 'Bukola Events',
          bankName: 'Zenith Bank',
          bankCode: '057',
          accountNumber: '0000004321',
          accountName: 'Bukola',
          paystackRecipientCode:
            'RCP_private_recipient',
          isPayoutReady: true,
          approvalStatus: 'approved',
        })

      expect(result).not.toBeNull()
      expect(
        result!.accountNumberLast4,
      ).toBe('4321')
      expect(result).not.toHaveProperty(
        'accountNumber',
      )
      expect(result).not.toHaveProperty(
        'paystackRecipientCode',
      )
    })

    it('sanitizes nested organizer and user credentials together', () => {
      const result = sanitizeUser({
        _id: 'user-id',
        fullname: 'Test Organizer',
        password: 'secret',
        emailVerificationOTP: '123456',
        passwordResetOTP: '654321',
        failedLoginAttempts: 2,
        avatarPublicId:
          'internal-cloudinary-id',
        organizerProfile: {
          accountNumber:
            '0123456789',
          paystackRecipientCode:
            'RCP_private',
          bankName: 'Test Bank',
        },
      })

      expect(result).not.toHaveProperty(
        'password',
      )
      expect(result).not.toHaveProperty(
        'emailVerificationOTP',
      )
      expect(result).not.toHaveProperty(
        'passwordResetOTP',
      )
      expect(result).not.toHaveProperty(
        'failedLoginAttempts',
      )
      expect(result).not.toHaveProperty(
        'avatarPublicId',
      )

      expect(
        result.organizerProfile
          .accountNumberLast4,
      ).toBe('6789')
      expect(
        result.organizerProfile,
      ).not.toHaveProperty(
        'accountNumber',
      )
      expect(
        result.organizerProfile,
      ).not.toHaveProperty(
        'paystackRecipientCode',
      )
    })
  },
)