import { config } from 'dotenv'

// Load .env file in local development
if (!process.env.VERCEL && process.env.NODE_ENV !== 'production') {
  config()
}

interface EnvSpec {
  key: string
  required?: boolean
}

const ENV_VARS: EnvSpec[] = [
  { key: 'MONGO_URI', required: true },
  { key: 'NODE_ENV', required: true },
   { key: 'API_URL', required: true },

  { key: 'LOG_LEVEL', required: true },
  { key: 'DATABASE_NAME', required: true },

  { key: 'SESSION_SECRET', required: true },
  { key: 'SESSION_MAX_AGE', required: true },
  { key: 'CLIENT_URL', required: true },

  { key: 'BREVO_API_KEY', required: true },
  { key: 'EMAIL_OWNER', required: true },

  { key: 'CRON_SECRET', required: true },

  { key: 'API_URL', required: true },

  { key: 'GOOGLE_CLIENT_ID', required: true },

  { key: 'MEMCACHIER_SERVERS', required: true },
  { key: 'MEMCACHIER_USERNAME', required: true },
  { key: 'MEMCACHIER_PASSWORD', required: true },

  
  { key: 'CLOUDINARY_CLOUD_NAME', required: true },
  { key: 'CLOUDINARY_API_KEY', required: true },
  { key: 'CLOUDINARY_API_SECRET', required: true },

  // Paystack
  { key: 'PAYSTACK_API_URL', required: true },
  { key: 'PAYSTACK_SECRET_KEY', required: true },

  // Bootstrap Admin
  { key: 'ADMIN_NAME' },
  { key: 'ADMIN_EMAIL' },
  { key: 'ADMIN_PASSWORD' },
  { key: 'ADMIN_PHONE' },
]

interface Env {
  readonly MONGO_URI: string
  readonly NODE_ENV: string

  readonly LOG_LEVEL: string
  readonly DATABASE_NAME: string

  readonly SESSION_SECRET: string
  readonly SESSION_MAX_AGE: string
  readonly CLIENT_URL: string

  readonly BREVO_API_KEY: string
  readonly EMAIL_OWNER: string

  readonly CRON_SECRET: string

  readonly API_URL: string
  readonly GOOGLE_CLIENT_ID: string

  readonly MEMCACHIER_SERVERS: string
  readonly MEMCACHIER_USERNAME: string
  readonly MEMCACHIER_PASSWORD: string

  readonly CLOUDINARY_CLOUD_NAME: string
  readonly CLOUDINARY_API_KEY: string
  readonly CLOUDINARY_API_SECRET: string

  readonly PAYSTACK_API_URL: string
  readonly PAYSTACK_SECRET_KEY: string

  readonly ADMIN_NAME: string
  readonly ADMIN_EMAIL: string
  readonly ADMIN_PASSWORD: string
  readonly ADMIN_PHONE: string
}

const env = process.env as unknown as Env


// Check required environment variables
const requiredKeys = ENV_VARS.filter(({ required }) => required)

const missingKeys = requiredKeys.filter(({ key }) => !env[key as keyof Env])

if (missingKeys.length > 0) {
  throw new Error(
    `Missing required env key(s): ${missingKeys
      .map(({ key }) => key)
      .join(', ')}`
  )
}

export { env }