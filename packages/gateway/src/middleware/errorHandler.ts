import type { Request, Response, NextFunction } from 'express';
import { AppError, sendError, ErrorCodes, createLogger } from '@sada/shared';

const logger = createLogger('gateway');

export function errorHandler(
    err: Error,
    req: Request,
    res: Response,
    _next: NextFunction
): void {
    // Log error
    logger.error('Request error', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
        requestId: res.locals['requestId'],
    });

    // Handle known errors
    if (err instanceof AppError) {
        sendError(res, err.code, err.message, err.statusCode, err.details);
        return;
    }

    // Handle unknown errors
    sendError(
        res,
        ErrorCodes.INTERNAL_ERROR,
        process.env['NODE_ENV'] === 'production'
            ? 'Internal server error'
            : err.message,
        500
    );
}
