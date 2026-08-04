import type { Request, Response } from 'express'
import { organizerService } from '../services/organizer.service.js'
import { sendTsRestError } from '../lib/responseHandler.js'



// Create organizer profile
export const createOrganizer = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId
    if (!userId) {
      sendTsRestError(res, 401, 'Unauthorized')
      return
    }

    const organizer = await organizerService.createOrganizer(userId, req.body)
    res.status(201).json({
      status: 'success',
      data: organizer,
    })
  } catch (error: any) {
    sendTsRestError(res, 400, error.message || 'Failed to create organizer profile')
  }
}


// Get organizer profile
export const getOrganizerProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId
    if (!userId) {
      sendTsRestError(res, 401, 'Unauthorized')
      return
    }

    const organizer = await organizerService.getOrganizerProfile(userId)
    res.status(200).json({
      status: 'success',
      data: organizer,
    })
  } catch (error: any) {
    sendTsRestError(res, 404, error.message || 'Organizer profile not found')
  }
}


// Update organizer profile
export const updateOrganizerProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId
    if (!userId) {
      sendTsRestError(res, 401, 'Unauthorized')
      return
    }

    const updated = await organizerService.updateOrganizerProfile(userId, req.body)
    res.status(200).json({
      status: 'success',
      data: updated,
    })
  } catch (error: any) {
    sendTsRestError(res, 400, error.message || 'Failed to update organizer profile')
  }
}


// Submit organizer profile for approval
export const submitForApproval = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId
    if (!userId) {
      sendTsRestError(res, 401, 'Unauthorized')
      return
    }

    const updated = await organizerService.submitForApproval(userId)
    res.status(200).json({
      status: 'success',
      message: 'Organizer profile submitted for approval',
      data: updated,
    })
  } catch (error: any) {
    sendTsRestError(res, 400, error.message || 'Failed to submit for approval')
  }
}