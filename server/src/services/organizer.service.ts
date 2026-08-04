import { Organizer, IOrganizer } from '../models/organizer.js'

export class OrganizerService {
  async createOrganizer(userId: string, data: Partial<IOrganizer>) {
    const existing = await Organizer.findOne({ user: userId })
    if (existing) {
      throw new Error('Organizer profile already exists for this user')
    }
    return await Organizer.create({ ...data, user: userId })
  }

  async getOrganizerProfile(userId: string) {
    const organizer = await Organizer.findOne({ user: userId }).populate('user', 'name email role')
    if (!organizer) {
      throw new Error('Organizer profile not found')
    }
    return organizer;
  }

  async updateOrganizerProfile(userId: string, updateData: Partial<IOrganizer>) {
    const organizer = await Organizer.findOneAndUpdate(
      { user: userId },
      { $set: updateData },
      { new: true, runValidators: true }
    )
    if (!organizer) {
      throw new Error('Organizer profile not found')
    }
    return organizer
  }

  async submitForApproval(userId: string) {
    const organizer = await Organizer.findOneAndUpdate(
      { user: userId },
      { $set: { approvalStatus: 'pending' } },
      { new: true }
    )
    if (!organizer) {
      throw new Error('Organizer profile not found')
    }
    return organizer
  }
}

export const organizerService = new OrganizerService()