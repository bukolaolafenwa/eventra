import MongoStore from 'connect-mongo'
import session from 'express-session'
import { env } from './keys.js'

// Session max age in milliseconds (default: 24 hours)
const SESSION_MAX_AGE = env.SESSION_MAX_AGE
  ? parseInt(env.SESSION_MAX_AGE, 10) || 24 * 60 * 60 * 1000
  : 24 * 60 * 60 * 1000

// Create MongoDB session store
const createSessionStore = () => {
  return MongoStore.create({
    mongoUrl: env.MONGO_URI,
    dbName: env.DATABASE_NAME,
    collectionName: 'sessions',
    touchAfter: 24 * 3600, // Lazy session update - only update once per day unless data changes
    autoRemove: 'native', // Use MongoDB TTL for session cleanup
    stringify: false, // Store as objects instead of strings for better performance
  })
}

// Session middleware configuration
export const createSessionMiddleware = () => {
  return session({
    secret: env.SESSION_SECRET,
    name: '_evtSessionId', // Custom cookie name to avoid default 'connect.sid'
    resave: false, // Don't save session if unmodified
    saveUninitialized: false, // Don't create session until something stored
    store: createSessionStore(),
    cookie: {
      maxAge: SESSION_MAX_AGE,
      httpOnly: true, // Prevent XSS attacks
      secure: env.NODE_ENV === 'production', // HTTPS only in production
      // 'none' is required for cross-site requests (e.g. localhost frontend -> Vercel backend),
      // but 'none' cookies are only honored by browsers when Secure is also true —
      // hence tying this to NODE_ENV the same way as `secure` above.
      sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
    },
    rolling: true, // Refresh expiration on every response
  })
}

export default createSessionMiddleware