import mongoose from 'mongoose'
import Category from '../models/category.js'
import { generateSlug } from '../utils/slug.js'
import type { CreateCategoryInput, UpdateCategoryInput, } from '../types/category.types.js'


/**
 * Generates a unique slug.
 */
const generateUniqueSlug = async (name: string): Promise<string> => {
  const baseSlug = generateSlug(name)
  let slug = baseSlug
  let counter = 1

  while (await Category.exists({ slug })) {
    slug = `${baseSlug}-${counter}`
    counter++
  }

  return slug
}


/**
 * Creates a new category.
 */
export const createCategory = async (
  payload: CreateCategoryInput
) => {
  // Prevent duplicate category names
  const categoryExists = await Category.exists({
    name: payload.name,
  })

  if (categoryExists) {
    throw new Error('Category already exists')
  }

  const slug = await generateUniqueSlug(payload.name)

  const category = await Category.create({
    ...payload,
    slug,
  })

  const createdCategory = await Category.findById(category._id)
    .select('-__v')
    .lean()

  return createdCategory
}


/**
 * Retrieves all categories.
 */
// export const getAllCategories = async () => {
//   return Category.find()
//     .sort({ createdAt: -1 })
//     .lean()
// }


export const getAllCategories = async () => {
  return Category.find()
    .select('-__v')
    .sort({ createdAt: -1 })
    .lean()
}



/**
 * Retrieves a category by its ID.
 */
export const getCategoryById = async (id: string) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error('Invalid category ID')
  }

  const category = await Category.findById(id)
    .select('-__v')
    .lean()

  if (!category) {
    throw new Error('Category not found')
  }

  return category
}



/**
 * Updates an existing category.
 */
export const updateCategory = async (
  id: string,
  payload: UpdateCategoryInput
) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error('Invalid category ID')
  }

  const category = await Category.findById(id)

  if (!category) {
    throw new Error('Category not found')
  }

  if (payload.name && payload.name !== category.name) {
    const categoryExists = await Category.exists({
      name: payload.name,
      _id: { $ne: id },
    })

    if (categoryExists) {
      throw new Error('Category already exists')
    }

    category.name = payload.name
    category.slug = await generateUniqueSlug(payload.name)
  }

  if (typeof payload.isActive === 'boolean') {
    category.isActive = payload.isActive
  }

  await category.save()

  const updatedCategory = await Category.findById(category._id)
    .select('-__v')
    .lean()

  return updatedCategory
}



/**
 * Deactivates a category (soft delete).
 */
export const deleteCategory = async (id: string) => {
  // Validate ObjectId
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error('Invalid category ID')
  }

  // Check that the category exists
  const category = await Category.findById(id)

  if (!category) {
    throw new Error('Category not found')
  }

  // Prevent unnecessary updates
  if (!category.isActive) {
    throw new Error('Category is already inactive')
  }

  // Soft delete
  category.isActive = false

  await category.save()

  const updatedCategory = await Category.findById(category._id)
    .select('-__v')
    .lean()

  return updatedCategory
}