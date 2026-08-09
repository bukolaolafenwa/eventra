import mongoose from 'mongoose'
import Category from '../models/category.js'
import { generateSlug } from '../utils/slug.js'
import { ErrorResponse } from '../middlewares/error.middleware.js'
import type { CreateCategoryInput, UpdateCategoryInput } from '../types/category.types.js'

export class CategoryService {
  private async generateUniqueSlug(name: string): Promise<string> {
    const baseSlug = generateSlug(name)
    let slug = baseSlug
    let counter = 1

    while (await Category.exists({ slug })) {
      slug = `${baseSlug}-${counter}`
      counter++
    }

    return slug
  }

  async createCategory(payload: CreateCategoryInput) {
    const categoryExists = await Category.exists({ name: payload.name })
    if (categoryExists) {
      throw new ErrorResponse('Category already exists', 409)
    }

    const slug = await this.generateUniqueSlug(payload.name)
    const category = await Category.create({ ...payload, slug })

    return Category.findById(category._id).select('-__v').lean()
  }

  async getAllCategories(includeInactive = false) {
    const filter = includeInactive ? {} : { isActive: true }
    return Category.find(filter).select('-__v').sort({ createdAt: -1 }).lean()
  }

  async getCategoryById(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ErrorResponse('Invalid category ID', 400)
    }

    const category = await Category.findById(id).select('-__v').lean()
    if (!category) {
      throw new ErrorResponse('Category not found', 404)
    }

    return category
  }

  async updateCategory(id: string, payload: UpdateCategoryInput) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ErrorResponse('Invalid category ID', 400)
    }

    const category = await Category.findById(id)
    if (!category) {
      throw new ErrorResponse('Category not found', 404)
    }

    if (payload.name && payload.name !== category.name) {
      const categoryExists = await Category.exists({ name: payload.name, _id: { $ne: id } })
      if (categoryExists) {
        throw new ErrorResponse('Category already exists', 409)
      }

      category.name = payload.name
      category.slug = await this.generateUniqueSlug(payload.name)
    }

    if (typeof payload.isActive === 'boolean') {
      category.isActive = payload.isActive
    }

    await category.save()

    return Category.findById(category._id).select('-__v').lean()
  }

  async deleteCategory(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ErrorResponse('Invalid category ID', 400)
    }

    const category = await Category.findById(id)
    if (!category) {
      throw new ErrorResponse('Category not found', 404)
    }
    if (!category.isActive) {
      throw new ErrorResponse('Category is already inactive', 400)
    }

    category.isActive = false
    await category.save()

    return Category.findById(category._id).select('-__v').lean()
  }

  async restoreCategory(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ErrorResponse('Invalid category ID', 400)
    }

    const category = await Category.findById(id)
    if (!category) {
      throw new ErrorResponse('Category not found', 404)
    }
    if (category.isActive) {
      throw new ErrorResponse('Category is already active', 400)
    }

    category.isActive = true
    await category.save()

    return Category.findById(category._id).select('-__v').lean()
  }
}

export const categoryService = new CategoryService()