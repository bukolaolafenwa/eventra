import mongoose from 'mongoose'

import { connectDB } from '../config/database.js'

import User from '../models/user.js'

/**
 * Bootstrap script for creating a test organizer account — mirrors
 * create-admin.ts's pattern. No env vars required; override via the
 * optional ones below if you want a specific identity, otherwise it
 * falls back to fixed test values.
 *
 * The organizerProfile is pre-set to approvalStatus: 'approved' and
 * isPayoutReady: true, so submitEventForApproval's gates (added in
 * event.controller.ts) don't block local testing — this account can
 * go all the way through create -> submit -> (admin approves) without
 * a second manual setup step.
 *
 * Safe to run multiple times. If the organizer already exists, nothing
 * will be created.
 */
const createOrganizer = async (): Promise<void> => {
  try {
    const email = process.env.ORGANIZER_EMAIL || 'organizer@test.local'
    const password = process.env.ORGANIZER_PASSWORD || 'TestPassword123!'
    const fullname = process.env.ORGANIZER_NAME || 'Test Organizer'
    const phone = process.env.ORGANIZER_PHONE || '+2348000000000'

    await connectDB()

    const existingOrganizer = await User.findOne({ email }).lean()

    if (existingOrganizer) {
      console.log('✅ Test organizer already exists.')
      console.table({ email, password })
      return
    }

    const organizer = await User.create({
      fullname,
      email,
      password,
      phone,
      role: 'organizer',
      isVerified: true,
      organizerProfile: {
        businessName: 'Test Organizer Co',
        category: 'General',
        city: 'Lagos',
        contactPhone: phone,
        publicEmail: email,
        bio: 'Bootstrap test organizer account for local Postman testing.',
        bankName: 'Test Bank',
        bankCode: '000',
        accountNumber: '0000000000',
        accountName: fullname,
        isPayoutReady: true,
        approvalStatus: 'approved',
        agreedToTerms: true,
        submittedAt: new Date(),
      },
    })

    console.log('✅ Test organizer created successfully.')
    console.table({
      id: organizer._id.toString(),
      fullname: organizer.fullname,
      email: organizer.email,
      password,
      role: organizer.role,
      approvalStatus: organizer.organizerProfile?.approvalStatus,
    })
  } catch (error) {
    console.error('❌ Failed to create test organizer.')

    if (error instanceof Error) {
      console.error(error.message)
    }

    process.exitCode = 1
  } finally {
    await mongoose.disconnect()
  }
}

createOrganizer()