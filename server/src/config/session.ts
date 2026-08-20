import MongoStore from 'connect-mongo'
import session from 'express-session'

import { env } from './keys.js'

// Session max age in milliseconds (default: 24 hours).
const SESSION_MAX_AGE =
  env.SESSION_MAX_AGE
    ? parseInt(
        env.SESSION_MAX_AGE,
        10,
      ) ||
      24 * 60 * 60 * 1000
    : 24 * 60 * 60 * 1000

const isProduction =
  env.NODE_ENV === 'production'

// Create the MongoDB-backed session store.
const createSessionStore = () => {
  return MongoStore.create({
    mongoUrl: env.MONGO_URI,
    dbName: env.DATABASE_NAME,
    collectionName: 'sessions',

    // Update an unchanged session in MongoDB at most once per day.
    touchAfter: 24 * 3600,

    // Use MongoDB's TTL index for expired-session cleanup.
    autoRemove: 'native',

    // Store session data as an object rather than a JSON string.
    stringify: false,
  })
}

// Session middleware configuration.
export const createSessionMiddleware =
  () => {
    return session({
      secret: env.SESSION_SECRET,

      // Custom name avoids exposing Express's default connect.sid name.
      name: '_evtSessionId',

      resave: false,
      saveUninitialized: false,
      store: createSessionStore(),

      cookie: {
        maxAge: SESSION_MAX_AGE,

        // Prevent client-side JavaScript from reading the cookie.
        httpOnly: true,

        // Cross-site production deployments require SameSite=None
        // together with Secure. Local HTTP development uses Lax.
        secure: isProduction,
        sameSite: isProduction
          ? 'none'
          : 'lax',
      },

      // Refresh the cookie expiry on every response.
      rolling: true,
    })
  }

export default createSessionMiddleware