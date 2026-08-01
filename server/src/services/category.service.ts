import Category from '../models/category.js'
import { generateSlug } from '../utils/slug.js'
import type { CreateCategoryInput } from '../types/category.types.js'

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

  return category
}