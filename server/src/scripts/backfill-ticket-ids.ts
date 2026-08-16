import { randomBytes } from 'crypto'
import mongoose from 'mongoose'

import { connectDB } from '../config/database.js'
import Ticket from '../models/ticket.js'

const generateTicketId = (): string =>
  `TK_${randomBytes(8).toString('hex').toUpperCase()}`

const backfillTicketIds = async (): Promise<void> => {
  const shouldApply = process.argv.includes('--apply')

  try {
    await connectDB()

    const tickets = await Ticket.find({
      $or: [
        { ticketId: { $exists: false } },
        { ticketId: null },
        { ticketId: '' },
      ],
    })
      .select('_id code')
      .lean()

    if (tickets.length === 0) {
      console.log('✅ Every existing ticket already has a ticket ID.')
      return
    }

    console.log(
      `Found ${tickets.length} ticket(s) without a ticket ID.`,
    )

    if (!shouldApply) {
      console.log('🔎 Dry run only. No database records were changed.')
      console.log(
        'Run npm run backfill:ticket-ids -- --apply to perform the update.',
      )
      return
    }

    let updatedCount = 0

    for (const ticket of tickets) {
      let ticketId = generateTicketId()

      while (await Ticket.exists({ ticketId })) {
        ticketId = generateTicketId()
      }

      const result = await Ticket.updateOne(
        {
          _id: ticket._id,
          $or: [
            { ticketId: { $exists: false } },
            { ticketId: null },
            { ticketId: '' },
          ],
        },
        {
          $set: { ticketId },
        },
      )

      if (result.modifiedCount === 1) {
        updatedCount += 1

        console.log(
          `✅ ${ticket.code} → ${ticketId}`,
        )
      }
    }

    const remainingCount = await Ticket.countDocuments({
      $or: [
        { ticketId: { $exists: false } },
        { ticketId: null },
        { ticketId: '' },
      ],
    })

    console.log(`Updated tickets: ${updatedCount}`)
    console.log(`Tickets still missing ticketId: ${remainingCount}`)

    if (remainingCount === 0) {
      console.log('✅ Ticket ID backfill completed successfully.')
    } else {
      throw new Error(
        `${remainingCount} ticket(s) still require a ticket ID.`,
      )
    }
  } catch (error: unknown) {
    console.error('❌ Ticket ID backfill failed.')

    if (error instanceof Error) {
      console.error(error.message)
    }

    process.exitCode = 1
  } finally {
    await mongoose.disconnect()
  }
}

backfillTicketIds()