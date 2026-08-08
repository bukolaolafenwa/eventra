import mongoose, { ConnectOptions } from 'mongoose'
import { env } from './keys.js'
import logger, { logError } from './logger.js'

let connectionPromise: Promise<typeof mongoose> | null = null


const connectionOptions: ConnectOptions = {
  dbName: env.DATABASE_NAME,
  serverSelectionTimeoutMS: 45000,
  socketTimeoutMS: 5000,
  retryReads: true,
  retryWrites: true,
  maxPoolSize: 50,
  minPoolSize: 1,
  monitorCommands: env.NODE_ENV === 'development',
}

// export const connectDB = async (): Promise<void> => {
//   // Already connected
//   if (mongoose.connection.readyState === 1) {
//     logger.info('Using existing MongoDB connection')
//     return
//   }

//   try {

export const connectDB = async (): Promise<void> => {
  // Already connected
  if (mongoose.connection.readyState === 1) {
    logger.info('Using existing MongoDB connection')
    return
  }

  // Connection already in progress
  if (mongoose.connection.readyState === 2) {
    logger.info('MongoDB connection already in progress')
    return
  }

  try {
    // const conn = await mongoose.connect(
    //   env.MONGO_URI,
    //   connectionOptions
    // )

    if (!connectionPromise) {
  connectionPromise = mongoose.connect(
    env.MONGO_URI,
    connectionOptions
  )
}

    const conn = await connectionPromise

    logger.info(`MongoDB Connected: ${conn.connection.host}`)

    // Register listeners only once
    if (mongoose.connection.listenerCount('error') === 0) {
      mongoose.connection.on('error', err => {
        logger.error('MongoDB connection error', err)
      })

      // mongoose.connection.on('disconnected', () => {
      //   logger.warn('MongoDB disconnected')
      // })
    mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected')
    connectionPromise = null
})
    }
  // } catch (error) {
  //   logError(error, 'MongoDB connection failed')
  //   throw error
  // }

  } catch (error) {
  connectionPromise = null
  logError(error, 'MongoDB connection failed')
  throw error
}
}

//handle graceful shutdown
export const gracefulShutDown = async (): Promise<void> => {
  try {
    logger.info(`Received shutdown signal. Closing server...`)
    //close mongodb connection
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close()
      logger.info(`MongoDb connection closed`)
    }
    logger.info(`Server shutdown complete`)
    process.exit(0)
  } catch (error) {
    logError(error, 'error during shutdown')
    process.exit(1)
  }
}

//handle uncaught exception
process.on('uncaughtException', (error: Error) => {
  logger.error(
    {
      err: { name: error.name },
      message: error.message,
    },
    `UNCAUGHT EXCEPTIONS! Shutting down`
  )
  gracefulShutDown().finally(() => process.exit(1))
})
