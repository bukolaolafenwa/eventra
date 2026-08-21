import mongoose from 'mongoose'
import { getPromotionPackage } from '../config/promotionPackages.js'
import { ErrorResponse } from '../middlewares/error.middleware.js'
import AdminActivity from '../models/adminActivity.js'
import Event from '../models/event.js'
import Order from '../models/order.js'
import RefundRequest from '../models/refundRequest.js'
import User from '../models/user.js'

export type DashboardRange = '7d' | '30d' | '1y'

const RANGE_DAYS: Record<DashboardRange, number> = {
  '7d': 7,
  '30d': 30,
  '1y': 365,
}

const getRangeStart = (range: DashboardRange, now = new Date()): Date => {
  const from = new Date(now)
  from.setUTCDate(from.getUTCDate() - RANGE_DAYS[range] + 1)
  from.setUTCHours(0, 0, 0, 0)
  return from
}

const getPreviousRangeStart = (rangeStart: Date, range: DashboardRange): Date => {
  const previous = new Date(rangeStart)
  previous.setUTCDate(previous.getUTCDate() - RANGE_DAYS[range])
  return previous
}

const percentChange = (current: number, previous: number): number | null => {
  if (previous === 0) {
    return current === 0 ? 0 : null
  }

  return Number((((current - previous) / previous) * 100).toFixed(1))
}

export const normalizeDashboardRange = (value: unknown): DashboardRange => {
  if (value === undefined) return '7d'
  if (value === '7d' || value === '30d' || value === '1y') return value
  throw new ErrorResponse('range must be one of 7d, 30d or 1y', 400)
}

const aggregateSales = async (from?: Date, to?: Date) => {
  const createdAt = from
    ? { $gte: from, ...(to ? { $lt: to } : {}) }
    : undefined

  const result = await Order.aggregate<{
    grossSales: number
    commissionRevenue: number
    refundedAmount: number
  }>([
    {
      $match: {
        status: { $in: ['paid', 'partially_refunded', 'refunded'] },
        ...(createdAt ? { createdAt } : {}),
      },
    },
    {
      $group: {
        _id: null,
        grossSales: { $sum: '$subtotal' },
        commissionRevenue: { $sum: '$serviceFee' },
        refundedAmount: { $sum: '$refundedAmount' },
      },
    },
  ])

  return {
    grossSales: result[0]?.grossSales ?? 0,
    commissionRevenue: result[0]?.commissionRevenue ?? 0,
    refundedAmount: result[0]?.refundedAmount ?? 0,
  }
}

const getPromotionRevenue = async (from?: Date, to?: Date): Promise<number> => {
  const events = await Event.find({
    'promotion.paidAt': {
      $exists: true,
      ...(from ? { $gte: from } : {}),
      ...(to ? { $lt: to } : {}),
    },
  })
    .select('promotion.package')
    .lean()

  return events.reduce((total, event) => {
    const promotionPackage = getPromotionPackage(event.promotion?.package)
    return total + (promotionPackage?.priceNaira ?? 0)
  }, 0)
}

const getHeldInEscrow = async (now: Date): Promise<number> => {
  const result = await Order.aggregate<{ amount: number }>([
    {
      $match: {
        status: { $in: ['paid', 'partially_refunded'] },
      },
    },
    {
      $lookup: {
        from: 'events',
        localField: 'event',
        foreignField: '_id',
        as: 'eventDoc',
      },
    },
    { $unwind: '$eventDoc' },
    {
      $match: {
        'eventDoc.startDate': { $gt: now },
        'eventDoc.status': { $in: ['approved', 'postponed'] },
      },
    },
    {
      $group: {
        _id: null,
        amount: {
          $sum: {
            $max: [
              0,
              {
                $subtract: [
                  '$subtotal',
                  { $add: ['$serviceFee', '$refundedAmount'] },
                ],
              },
            ],
          },
        },
      },
    },
  ])

  return result[0]?.amount ?? 0
}

const getRevenueSeries = async (from: Date, range: DashboardRange) => {
  const unit = range === '1y' ? 'month' : 'day'
  return Order.aggregate<{ period: Date; grossSales: number; platformRevenue: number }>([
    {
      $match: {
        status: { $in: ['paid', 'partially_refunded', 'refunded'] },
        createdAt: { $gte: from },
      },
    },
    {
      $group: {
        _id: { $dateTrunc: { date: '$createdAt', unit, timezone: 'UTC' } },
        grossSales: { $sum: '$subtotal' },
        platformRevenue: { $sum: '$serviceFee' },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        period: '$_id',
        grossSales: 1,
        platformRevenue: 1,
      },
    },
  ])
}

const getTopOrganizers = async (limit: number) =>
  Order.aggregate<{
    organizerId: mongoose.Types.ObjectId
    organizerName: string
    businessName?: string
    grossSales: number
    ticketsSold: number
  }>([
    { $match: { status: { $in: ['paid', 'partially_refunded', 'refunded'] } } },
    {
      $lookup: {
        from: 'events',
        localField: 'event',
        foreignField: '_id',
        as: 'eventDoc',
      },
    },
    { $unwind: '$eventDoc' },
    {
      $group: {
        _id: '$eventDoc.organizer',
        grossSales: { $sum: '$subtotal' },
        ticketsSold: { $sum: { $sum: '$items.quantity' } },
      },
    },
    { $sort: { grossSales: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'organizer',
      },
    },
    { $unwind: '$organizer' },
    {
      $project: {
        _id: 0,
        organizerId: '$_id',
        organizerName: '$organizer.fullname',
        businessName: '$organizer.organizerProfile.businessName',
        grossSales: 1,
        ticketsSold: 1,
      },
    },
  ])

export class AdminDashboardService {
  async getOverview(range: DashboardRange) {
    const now = new Date()
    const rangeStart = getRangeStart(range, now)
    const previousStart = getPreviousRangeStart(rangeStart, range)
    const startOfToday = new Date(now)
    startOfToday.setUTCHours(0, 0, 0, 0)

    const [
      currentSales,
      previousSales,
      currentPromotionRevenue,
      previousPromotionRevenue,
      heldInEscrow,
      revenueSeries,
      pendingEvents,
      pendingOrganizers,
      pendingPromotions,
      pendingRefunds,
      activeEvents,
      suspendedEvents,
      totalPaidOrders,
      refundedOrders,
      newOrganizersToday,
      topOrganizers,
      recentActivity,
    ] = await Promise.all([
      aggregateSales(rangeStart),
      aggregateSales(previousStart, rangeStart),
      getPromotionRevenue(rangeStart),
      getPromotionRevenue(previousStart, rangeStart),
      getHeldInEscrow(now),
      getRevenueSeries(rangeStart, range),
      Event.countDocuments({ status: 'pending_approval' }),
      User.countDocuments({ role: 'organizer', 'organizerProfile.approvalStatus': 'pending' }),
      Event.countDocuments({ 'promotion.status': 'pending' }),
      RefundRequest.countDocuments({ status: 'pending' }),
      Event.countDocuments({ status: { $in: ['approved', 'postponed'] } }),
      Event.countDocuments({ status: 'suspended' }),
      Order.countDocuments({ status: { $in: ['paid', 'partially_refunded', 'refunded'] } }),
      Order.countDocuments({ status: { $in: ['partially_refunded', 'refunded'] } }),
      User.countDocuments({ role: 'organizer', createdAt: { $gte: startOfToday } }),
      getTopOrganizers(5),
      AdminActivity.find()
        .populate('actor', 'fullname email')
        .sort({ createdAt: -1 })
        .limit(8)
        .lean(),
    ])

    const platformRevenue = currentSales.commissionRevenue + currentPromotionRevenue
    const previousPlatformRevenue = previousSales.commissionRevenue + previousPromotionRevenue

    return {
      range,
      generatedAt: now,
      reviewQueue: {
        pendingEvents,
        pendingOrganizers,
        pendingPromotions,
        pendingRefunds,
      },
      metrics: {
        grossTicketSales: currentSales.grossSales,
        grossTicketSalesChangePercent: percentChange(currentSales.grossSales, previousSales.grossSales),
        platformRevenue,
        platformRevenueChangePercent: percentChange(platformRevenue, previousPlatformRevenue),
        commissionRevenue: currentSales.commissionRevenue,
        promotionRevenue: currentPromotionRevenue,
        heldInEscrow,
        activeEvents,
      },
      trustAndSafety: {
        flaggedEvents: suspendedEvents,
        openPaymentDisputes: null,
        paymentDisputesAvailable: false,
        refundRatePercent:
          totalPaidOrders === 0
            ? 0
            : Number(((refundedOrders / totalPaidOrders) * 100).toFixed(1)),
        newOrganizersToday,
      },
      revenueSeries,
      recentActivity,
      topOrganizers,
    }
  }

  async getActivities(limit: number) {
    return AdminActivity.find()
      .populate('actor', 'fullname email')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
  }

  async getTopOrganizers(limit: number) {
    return getTopOrganizers(limit)
  }
}

export const adminDashboardService = new AdminDashboardService()
