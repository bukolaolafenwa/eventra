import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  let statusCode = 500;
  let message = 'Internal Server Error';

  // Generic error handling based on the error's message property
  if (err.message) {
    statusCode = err.statusCode || 400;
    message = err.message;
  }

  res.status(statusCode).json({
    success: false,
    data: null,
    error: message,
  });
}