import Category, { ICategory } from '../models/category.js'

interface CreateCategoryInput {
  name: string
  description?: string
  icon?: string
  isActive?: boolean
}

interface UpdateCategoryInput {
  name?: string
  description?: string
  icon?: string
  isActive?: boolean
}

interface GetCategoriesFilters {
  page: number
  limit: number
  isActive?: boolean
  search?: string
}

interface GetCategoriesResult {
  categories: ICategory[]
  total: number
}

/**
 * Converts a category name into a URL-safe slug.
 * e.g. "Music & Arts" -> "music-and-arts"
 */
const slugify = (name: string): string => {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-') // any run of non-alphanumeric chars -> single hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
}

export class CategoryService {
  /**
   * Creates a new category. Slug is auto-derived from name.
   * Relies on the schema's unique index on `name`/`slug` — if a duplicate
   * is attempted, Mongoose throws a duplicate-key (11000) error, which
   * the global error handler already knows how to translate into a
   * proper client-facing response. No need to manually check for
   * existence first.
   */
  async createCategory(input: CreateCategoryInput): Promise<ICategory> {
    const slug = slugify(input.name)

    const category = await Category.create({
      name: input.name.trim(),
      slug,
      description: input.description?.trim(),
      icon: input.icon?.trim(),
      isActive: input.isActive ?? true,
    })

    return category
  }

  /**
   * Returns a paginated list of categories, optionally filtered by
   * active status or a name search term.
   */
  async getCategories(filters: GetCategoriesFilters): Promise<GetCategoriesResult> {
    const { page, limit, isActive, search } = filters

    const query: Record<string, unknown> = {}

    if (typeof isActive === 'boolean') {
      query.isActive = isActive
    }

    if (search) {
      // Case-insensitive partial match on name
      query.name = { $regex: search, $options: 'i' }
    }

    const skip = (page - 1) * limit

    // Run the count and the page fetch in parallel — independent queries
    const [categories, total] = await Promise.all([
      Category.find(query).sort({ name: 1 }).skip(skip).limit(limit).lean(),
      Category.countDocuments(query),
    ])

    return { categories: categories as ICategory[], total }
  }

  /**
   * Finds a single category by its MongoDB _id OR its slug — whichever
   * was passed in. Lets routes support both `/categories/:id` (internal use)
   * and `/categories/slug/:slug` (public-facing, human-readable URLs) via
   * a single service method.
   */
  async getCategory(identifier: string): Promise<ICategory | null> {
    // A valid Mongo ObjectId is a 24-character hex string — anything else
    // must be a slug.
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(identifier)

    const query = isObjectId ? { _id: identifier } : { slug: identifier }

    return Category.findOne(query).lean()
  }

  /**
   * Updates a category. If `name` changes, the slug is regenerated to
   * match — kept in sync automatically so nobody has to remember to
   * update both fields separately.
   */
  async updateCategory(id: string, input: UpdateCategoryInput): Promise<ICategory | null> {
    const updates: Record<string, unknown> = { ...input }

    if (input.name) {
      updates.name = input.name.trim()
      updates.slug = slugify(input.name)
    }

    // { new: true } returns the document AFTER the update is applied,
    // not the stale pre-update version
    return Category.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    }).lean()
  }

  /**
   * Deletes a category by id. Returns the deleted document (or null if
   * it didn't exist) so the controller can distinguish "deleted" from
   * "nothing to delete".
   */
  async deleteCategory(id: string): Promise<ICategory | null> {
    return Category.findByIdAndDelete(id).lean()
  }
}

export const categoryService = new CategoryService()
