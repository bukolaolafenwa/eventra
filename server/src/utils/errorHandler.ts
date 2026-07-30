import { Request, Response, NextFunction } from 'express';
import { ValidationError } from './validation.js'

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  let statusCode = 500;
  let message = 'Internal Server Error';

  if (err instanceof ValidationError) {
    statusCode = 400;
    message = err.details.errors.map(e => e.message).join(', ');
  } else if (err.message) {
    // You can map custom errors here
    statusCode = err.statusCode || 400;
    message = err.message;
  }

  res.status(statusCode).json({
    success: false,
    data: null,
    error: message,
  });
}