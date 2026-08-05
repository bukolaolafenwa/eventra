import express, { NextFunction, Request, Response } from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import { connectDB, gracefulShutDown } from './config/database.js'
import { env } from './config/keys.js'
import logger, { logError } from './config/logger.js'
import createSessionMiddleware from './config/session.js'
import { globalLimiter } from './middlewares/rateLimit.middleware.js'
import emailRoutes from './routes/email.routes.js'
import authRoutes from './routes/auth.routes.js'
import userRoutes from './routes/user.routes.js'
import eventRoutes from './routes/event.routes.js'
import categoryRoutes from './routes/category.routes.js'

import {
  appErrorHandler,
  createExpressLogger,
  notFoundRoutes,
  setupGlobalErrorHandlers,
} from './middlewares/error.middleware.js'

 const connectionStates: Record<number, string> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  }


declare global {
  namespace Express {
    interface Request {
      requestTime?: string
      rawBody?: Buffer
    }
  }
}

// just added this to avoid the error "Cannot redeclare block-scoped variable 'Request'." in TypeScript

// Extend express-session SessionData interface
declare module 'express-session' {
  interface SessionData {
    userId?: string
    role?: 'attendee' | 'organizer' | 'admin'
  }
}

const app = express()

setupGlobalErrorHandlers()

// lean path - cron doesn't need CORS, sesions or body 
app.use('/api', emailRoutes)

// CORS configuration
const normalizeOrigin = (url: string): string => url.replace(/\/+$/, '')

const allowedOrigins = [
  env.CLIENT_URL,
  'http://localhost:4000',
  'http://localhost:4001',
  'http://localhost:4002',
  'http://127.0.0.1:4000',
  'http://127.0.0.1:4001',
  'http://127.0.0.1:4002',
]
  .filter(Boolean)
  .map(normalizeOrigin)

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests without an Origin header (Postman, mobile apps, server-to-server)
    if (!origin) {
      return callback(null, true)
    }

    if (allowedOrigins.includes(normalizeOrigin(origin))) {
      return callback(null, true)
    }

    console.error(`❌ CORS blocked origin: ${origin}`)
    return callback(new Error(`Origin ${origin} is not allowed by CORS`))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  optionsSuccessStatus: 200,
  allowedHeaders: ['Content-Type', 'Authorization', 'Access-Control-Allow-Origin', 'Access-Control-Allow-Credentials'],
  exposedHeaders: ['Content-Range', 'X-Content-Range', 'x-refresh-token', 'set-cookie'],
}

app.use(createExpressLogger())//pino http logger middleware for request logging
// Use session middleware before defining routes 
app.use(createSessionMiddleware())

app.set('trust-proxy', 1)
app.use(cors(corsOptions))
app.use(globalLimiter) // Apply rate limiting to all requests
app.use(express.json({ limit: '25mb' }))
app.use(express.urlencoded({ extended: true, limit: '25mb' }))
app.disable('x-powered-by')

app.use((req: Request, res: Response, next: NextFunction) => {
  req.requestTime = new Date().toISOString()
  next()
})

// app.use('/health', (req: Request, res: Response, next: NextFunction) => {
//   res.status(200).json({
//     status: 'success',
//     message: 'Server is running',
//     environment: env.NODE_ENV,
//     timestamp: req.requestTime,
//     uptime: process.uptime(),
//   })
// })


// app.get('/health', (req: Request, res: Response) => {
//   res.status(200).json({
//     status: 'success',
//     message: 'Server is healthy',
//     environment: env.NODE_ENV,
//     timestamp: req.requestTime,
//     uptime: process.uptime(),
//     database:
//       mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
//     version: process.env.npm_package_version || '1.0.0',
//   })
// })

// health check endpoint for serverless environments like Vercel
app.get('/health', (req: Request, res: Response) => {
  const readyState = mongoose.connection.readyState

  res.status(200).json({
    status: 'success',
    message: 'Server is healthy',
    environment: env.NODE_ENV,
    timestamp: req.requestTime,
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    node: process.version,
    pid: process.pid,
    database: {
      status: connectionStates[readyState] ?? 'unknown',
      readyState,
    },
  })
})


// Routes
app.use('/api/v1/auth', authRoutes)
app.use('/api/v1/events', eventRoutes)
app.use('/api/v1/users', userRoutes)
app.use('/api/v1/categories', categoryRoutes)

// Handle 404
app.use(notFoundRoutes)
// Global error handler
app.use(appErrorHandler)



const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000
const startServer = async (): Promise<void> => {
  let server: any
  try {
    await connectDB()
    server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Server running in ${env.NODE_ENV} mode on port ${PORT}`)
      logger.info(`http://localhost:${PORT}`)
    })
    //HANDLE unhandled promise rejections
    process.on('unhandledRejection', (reason: unknown) => {
      console.error(`UNHANDLED REJECTION! Shutting down...`)
      const error = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)
      logger.error({ reason: error }, 'Unhandled rejection')

      //close server gracefully
      server.close(() => {
        logger.info(`Process terminated due to unhandled rejection`)
        logger.info('Server shutdown complete')
      })
    })
    //handle termination signals
    process.on('SIGTERM', gracefulShutDown)
    process.on('SIGINT', gracefulShutDown)

    // Handle any other errors
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.syscall !== 'listen') throw error

      switch (error.code) {
        case 'EACCES':
          logger.error(`Port ${PORT} requires elevated privileges`)
          process.exit(1)
        case 'EADDRINUSE':
          logger.error(`Port ${PORT} is already in use`)
          process.exit(1)
        default:
          throw error
      }
    })
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logError(` Failed to start server: ${errorMessage}`)
    process.exit(1)
  }
}

if (!process.env.VERCEL) {
  startServer()
} else {
  connectDB().catch(err => {
    console.error('Serverless DB connection failed:', err)
  })
}

export default app
