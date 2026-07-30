import crypto from 'crypto'

/**
 * Generate a numeric OTP of the given length (default 6 digits).
 */
export const generateOTP = (length: number = 6): string => {
  const digits = '0123456789'
  let otp = ''
  for (let i = 0; i < length; i++) {
    otp += digits[crypto.randomInt(0, digits.length)]
  }
  return otp
}

/**
 * Slugify a string for use in URLs (e.g. event titles).
 */
export const slugify = (value: string): string => {
  return value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/**
 * Strip sensitive/internal fields off a Mongoose lean user doc before sending to the client.
 */
export const sanitizeUser = (user: Record<string, any>): Record<string, any> => {
  const { password, emailVerificationOTP, emailVerificationOTPExpiry, __v, ...safe } = user
  return safe
}

/**
 * Escapes regex special characters in user-supplied search text before it's
 * used to build a `new RegExp(...)` — without this, a query string like
 * `.*` or a long pathological pattern can behave unexpectedly or cause a
 * slow regex match (ReDoS) instead of matching as a literal substring.
 */
export const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * True only for a syntactically valid Mongo ObjectId string. Use this before
 * assigning a raw query-param value onto a Mongoose filter object — express's
 * query parser turns `?field[$ne]=x` into `{ field: { $ne: 'x' } }`, so a
 * filter built from an unvalidated query value can smuggle in Mongo operators.
 */
export const isValidObjectId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f\d]{24}$/i.test(value)

/**
 * Standard pagination extractor for controllers.
 */
export const getPagination = (query: Record<string, any>) => {
  const page = Math.max(Number(query.page) || 1, 1)
  const limit = Math.max(Number(query.limit) || 10, 1)
  const skip = (page - 1) * limit
  return { page, limit, skip }
}

/**
 * Build the `meta` object for paginated responses.
 */
export const buildPaginationMeta = (currentPage: number, limit: number, total: number) => {
  const totalPages = Math.max(Math.ceil(total / limit), 1)
  return {
    currentPage,
    limit,
    total,
    totalPages,
    hasMore: currentPage < totalPages,
  }
}
