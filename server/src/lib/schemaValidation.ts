import { z } from 'zod'
import mongoose from 'mongoose'

export const registerSchema = z.object({
  fullname: z.string().trim().min(2, 'Fullname must be at least 2 characters'),
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  // Optional here because the organizer sign-up form doesn't collect a
  // phone number (see the Figma) — enforced as required for attendees at
  // the client-side schema instead (lib/schema.ts's registerSchema),
  // since that's a UX choice, not a data-integrity one.
  phone: z.string().trim().min(7, 'Invalid phone number').optional(),
  role: z.enum(['attendee', 'organizer']).optional(),
})

export const verifyEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
})

export const resendOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
})

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export const googleAuthSchema = z.object({
  credential: z
    .string({
      error: 'Google credential is required',
    })
    .trim()
    .min(1, 'Google credential is required'),
  role: z
    .enum(['attendee', 'organizer'])
    .optional(),
})

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
})

export const resetPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
})

const objectIdSchema = z.string().trim().refine((val) => mongoose.Types.ObjectId.isValid(val), {
  message: 'Invalid ID.',
})

export const checkoutSchema = z.object({
  customer: z.object({
    fullname: z.string().trim().min(2, 'fullname is required'),
    email: z.string().trim().toLowerCase().email('Invalid email address'),
    phone: z.string().trim().min(7, 'Invalid phone number').optional(),
  }),
  items: z
    .array(
      z.object({
        ticketTypeId: objectIdSchema,
        quantity: z
          .number()
          .int()
          .positive('quantity must be a positive integer'),
      })
    )
    .min(1, 'At least one ticket item is required'),
})

// export const checkoutSchema = z.object({
//   items: z
//     .array(
//       z.object({
//         ticketTypeId: z.string().trim().min(1, 'ticketTypeId is required'),
//         quantity: z.number().int().positive('quantity must be a positive integer'),
//       })
//     )
//     .min(1, 'At least one ticket item is required'),
// })

export const organizerProfileSchema = z.object({
  businessName: z.string().trim().min(2).optional(),
  category: z.string().trim().min(1).optional(),
  city: z.string().trim().min(2).optional(),
  contactPhone: z.string().trim().min(7).optional(),
  publicEmail: z.string().trim().toLowerCase().email().optional(),
  bio: z.string().trim().max(280).optional(),
  bankName: z.string().trim().min(2).optional(),
  bankCode: z.string().trim().min(2).optional(),
  accountNumber: z.string().trim().min(10).max(10).optional(),
  accountName: z.string().trim().min(2).optional(),
  agreedToTerms: z.boolean().optional(),
})

export const resolveBankAccountSchema = z.object({
  accountNumber: z.string().trim().min(10).max(10),
  bankCode: z.string().trim().min(2),
})

const venueSchema = z.object({
  name: z.string().trim().min(2),
  address: z.string().trim().min(3),
  city: z.string().trim().min(2),
  state: z.string().trim().optional(),
})

export const lineupMemberSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  role: z.string().trim().min(1, 'role is required'),
  imageUrl: z.string().trim().url().optional(),
})

export const updateEventLineupSchema = z.object({
  lineup: z
    .array(lineupMemberSchema)
    .max(30, 'Lineup can have at most 30 entries'),
})

const eventSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters'),
  description: z.string().trim().min(10, 'Description must be at least 10 characters'),
  category: objectIdSchema,
  type: z.enum(['free', 'paid']),
  coverImage: z.string().trim().url(),
  venue: venueSchema,
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  capacity: z.number().int().positive().optional(),
  refundPolicy: z
    .object({
      type: z.enum(['no-refunds', 'refund-until-days-before']),
      daysBefore: z.number().int().min(0).optional(),
    })
    .optional(),

      // Whole-array replace on every save — organizer submits the current full
  // lineup each time rather than individual add/remove diffs.
  lineup: z
    .array(lineupMemberSchema)
    .max(30, 'Lineup can have at most 30 entries')
    .optional(),

  // Provisional — see the matching comment on IEvent.agePolicy in event.ts.
  agePolicy: z.enum(['all-ages', '13+', '16+', '18+', '21+']).optional(),
})

export const createEventSchema = eventSchema
  .refine(
    data => !data.endDate || data.endDate >= data.startDate,
    {
      message: 'End date must be after or equal to the start date.',
      path: ['endDate'],
    }
  )
  .refine(
    data =>
      !data.refundPolicy ||
      data.refundPolicy.type === 'no-refunds' ||
      data.refundPolicy.daysBefore !== undefined,
    {
      message: 'daysBefore is required when using refund-until-days-before.',
      path: ['refundPolicy', 'daysBefore'],
    }
  )
  .refine(
    data => data.type !== 'paid' || !!data.refundPolicy,
    {
      message: 'Refund policy is required for paid events.',
      path: ['refundPolicy'],
    }
  )
  .refine(
    data => data.startDate >= new Date(new Date().setHours(0, 0, 0, 0)),
    {
      message: 'Start date cannot be in the past.',
      path: ['startDate'],
    }
  )


// export const createEventSchema = z.object({
//   title: z.string().trim().min(3, 'Title must be at least 3 characters'),
//   description: z.string().trim().min(10, 'Description must be at least 10 characters'),
//   category: z.string().trim().min(1, 'category is required'),
//   type: z.enum(['free', 'paid']),
//   coverImage: z.string().trim().url().optional(),
//   venue: venueSchema,
//   startDate: z.coerce.date(),
//   endDate: z.coerce.date().optional(),
//   capacity: z.number().int().positive().optional(),
//   refundPolicy: z
//     .object({
//       type: z.enum(['no-refunds', 'refund-until-days-before']),
//       daysBefore: z.number().int().min(0).optional(),
//     })
//     .optional(),
// })

// export const updateEventSchema = createEventSchema.partial()

export const updateEventSchema = eventSchema
  .partial()
  .refine(
    data =>
      !data.startDate ||
      !data.endDate ||
      data.endDate >= data.startDate,
    {
      message: 'End date must be after or equal to the start date.',
      path: ['endDate'],
    }
  )
  .refine(
    data =>
      !data.refundPolicy ||
      data.refundPolicy.type === 'no-refunds' ||
      data.refundPolicy.daysBefore !== undefined,
    {
      message: 'daysBefore is required when using refund-until-days-before.',
      path: ['refundPolicy', 'daysBefore'],
    }
  )
  // Only fires when startDate is actually part of this update — editing
  // unrelated fields on an event whose startDate has already passed must
  // not fail.
  .refine(
    data => !data.startDate || data.startDate >= new Date(new Date().setHours(0, 0, 0, 0)),
    {
      message: 'Start date cannot be in the past.',
      path: ['startDate'],
    }
  )
  

interface TicketTypeSalesPeriod {
  salesStartDate?: Date
  salesEndDate?: Date
}

const ticketTypeBaseSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),

  description: z
    .string()
    .trim()
    .max(200, 'description cannot exceed 200 characters')
    .optional(),

  // Stored as whole naira.
  price: z
    .number()
    .int('price must be a whole naira amount')
    .min(0, 'price cannot be negative'),

  quantity: z
    .number()
    .int('quantity must be a whole number')
    .positive('quantity must be greater than zero'),

  purchaseLimitPerPerson: z
    .number()
    .int('purchaseLimitPerPerson must be a whole number')
    .positive('purchaseLimitPerPerson must be greater than zero')
    .optional(),

  salesStartDate: z.coerce.date().optional(),

  salesEndDate: z.coerce.date().optional(),
})

const hasValidTicketSalesPeriod = (
  data: TicketTypeSalesPeriod
): boolean => {
  if (!data.salesStartDate || !data.salesEndDate) {
    return true
  }

  return data.salesEndDate > data.salesStartDate
}

export const createTicketTypeSchema = ticketTypeBaseSchema.refine(
  hasValidTicketSalesPeriod,
  {
    message: 'Sales end date must be after sales start date',
    path: ['salesEndDate'],
  }
)

export const updateTicketTypeSchema = ticketTypeBaseSchema
  .partial()
  .extend({
    isActive: z.boolean().optional(),
  })
  .refine(hasValidTicketSalesPeriod, {
    message: 'Sales end date must be after sales start date',
    path: ['salesEndDate'],
  })



export const createCategorySchema = z.object({
  name: z.string().trim().min(2, 'name is required'),
})

export const updateCategorySchema = z.object({
  name: z.string().trim().min(2).optional(),
})

export const rejectEventSchema = z.object({
  reason: z.string().trim().min(3, 'A rejection reason is required'),
})

// Model already supports status: 'suspended' + suspendedReason (see
// models/event.ts), but there's no admin.controller.ts handler yet to
// actually trigger it — that's Person C's file, flagging for them.
export const suspendEventSchema = z.object({
  reason: z.string().trim().min(3, 'A reason is required to suspend an event'),
})

export const updateProfileSchema = z
  .object({
    fullname: z.string().trim().min(2).optional(),
    phone: z.string().trim().min(7).optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8).optional(),
  })
  .refine(data => !data.newPassword || !!data.currentPassword, {
    message: 'currentPassword is required to set a new password',
    path: ['currentPassword'],
  })

export const refundRequestSchema = z.object({
  reason: z.string().trim().max(500).optional(),
})

export const checkInSchema = z.object({
  code: z.string().trim().min(1, 'code is required'),
})

export const requestPromotionSchema = z.object({
  packageId: z.string().trim().min(1, 'packageId is required'),
})

export const postponeEventSchema = z.object({
  newStartDate: z.coerce.date().refine(
    date => date >= new Date(new Date().setHours(0, 0, 0, 0)),
    { message: 'New date cannot be in the past' }
  ),
})