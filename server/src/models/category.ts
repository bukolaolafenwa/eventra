import mongoose, { Document, Schema } from 'mongoose'

export interface ICategory extends Document {
  _id: mongoose.Types.ObjectId
  name: string
  slug: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

const CategorySchema = new Schema<ICategory>(
  {
  name: {
  type: String,
  required: true,
  trim: true,
  unique: true,
},

slug: {
  type: String,
  required: true,
  unique: true,
  lowercase: true,
  trim: true,
},

isActive: {
  type: Boolean,
  default: true,
},
  },
  {
    timestamps: true,
  }
)

/**
 * Indexes
 */
// Supports listing active categories alphabetically
CategorySchema.index({ isActive: 1, name: 1 })

const Category =
  mongoose.models.Category ||
  mongoose.model<ICategory>('Category', CategorySchema, 'categories')

export default Category