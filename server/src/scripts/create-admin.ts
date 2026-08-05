import mongoose from 'mongoose'

import { connectDB } from '../config/database.js'
import { env } from '../config/keys.js'

import User from '../models/user.js'

/**
 * Bootstrap script for creating the initial administrator account.
 *
 * Safe to run multiple times.
 * If the admin already exists, nothing will be created.
 */
const createAdmin = async (): Promise<void> => {
  try {
    if (
      !env.ADMIN_NAME ||
      !env.ADMIN_EMAIL ||
      !env.ADMIN_PASSWORD ||
      !env.ADMIN_PHONE
    ) {
      throw new Error(
        'Missing ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD or ADMIN_PHONE environment variables.'
      )
    }

    await connectDB()

    const existingAdmin = await User.findOne({
      email: env.ADMIN_EMAIL,
    }).lean()

    if (existingAdmin) {
      console.log('✅ Admin already exists.')
      return
    }

    const admin = await User.create({
      fullname: env.ADMIN_NAME,
      email: env.ADMIN_EMAIL,
      password: env.ADMIN_PASSWORD,
      phone: env.ADMIN_PHONE,
      role: 'admin',
      isVerified: true,
    })

    console.log('✅ Admin created successfully.')
    console.table({
      id: admin._id.toString(),
      fullname: admin.fullname,
      email: admin.email,
      role: admin.role,
    })
  } catch (error) {
    console.error('❌ Failed to create admin.')

    if (error instanceof Error) {
      console.error(error.message)
    }

    process.exitCode = 1
  } finally {
    await mongoose.disconnect()
  }
}

createAdmin()