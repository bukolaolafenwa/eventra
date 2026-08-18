import mongoose from 'mongoose'
import {
  describe,
  expect,
  it,
} from 'vitest'

import Payout from './payout.js'

const createValidPayout = (
  overrides: Record<string, unknown> = {},
) =>
  new Payout({
    organizer:
      new mongoose.Types.ObjectId(),
    event:
      new mongoose.Types.ObjectId(),
    orders: [
      new mongoose.Types.ObjectId(),
    ],

    grossAmount: 10000,
    refundedAmount: 0,
    commissionAmount: 500,
    netAmount: 9500,
    currency: 'NGN',

    provider: 'paystack',
    recipientCode: 'RCP_test_recipient',
    reference: `eventra-payout-${new mongoose.Types.ObjectId()}`,

    destination: {
      bankName: 'Test Bank',
      bankCode: '999',
      accountName: 'Test Organizer',
      accountNumberLast4: '4321',
    },

    status: 'pending',
    eligibleAt: new Date(),
    initiatedBy:
      new mongoose.Types.ObjectId(),

    ...overrides,
  })

describe('Payout model validation', () => {
  it('accepts consistent payout accounting', async () => {
    const payout = createValidPayout()

    await expect(
      payout.validate(),
    ).resolves.toBeUndefined()
  })

  it('rejects duplicate orders within one payout', async () => {
    const orderId =
      new mongoose.Types.ObjectId()

    const payout = createValidPayout({
      orders: [orderId, orderId],
    })

    await expect(
      payout.validate(),
    ).rejects.toThrow(
      /cannot contain duplicate orders/i,
    )
  })

  it('rejects refunds greater than gross sales', async () => {
    const payout = createValidPayout({
      grossAmount: 10000,
      refundedAmount: 11000,
      commissionAmount: 0,
      netAmount: 1,
    })

    await expect(
      payout.validate(),
    ).rejects.toThrow(
      /refunded amount cannot exceed gross amount/i,
    )
  })

  it('rejects an incorrect net payout amount', async () => {
    const payout = createValidPayout({
      grossAmount: 10000,
      refundedAmount: 0,
      commissionAmount: 500,
      netAmount: 9700,
    })

    await expect(
      payout.validate(),
    ).rejects.toThrow(
      /net amount must equal gross amount/i,
    )
  })
})