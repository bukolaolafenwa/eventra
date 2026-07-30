import { z, ZodSchema } from 'zod';

export class ValidationError extends Error {
  constructor(public details: z.ZodError) {
    super('Validation failed');
    this.name = 'ValidationError';
  }
}

export function validate<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(result.error);
  }
  return result.data;
}