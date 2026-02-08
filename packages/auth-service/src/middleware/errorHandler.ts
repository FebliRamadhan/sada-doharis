import type { Request, Response, NextFunction } from 'express';
import { AppError, sendError, ErrorCodes, createLogger } from '@sada/shared';

const logger = createLogger('auth-service');

export function errorHandler(
    err: Error,
    req: Request,
    res: Response,
    _next: NextFunction
): void {
    logger.error('Request error', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
        requestId: res.locals['requestId'],
    });

    if (err instanceof AppError) {
        sendError(res, err.code, err.message, err.statusCode, err.details);
        return;
    }

    sendError(
        res,
        ErrorCodes.INTERNAL_ERROR,
        process.env['NODE_ENV'] === 'production'
            ? 'Internal server error'
            : err.message,
        500
    );
}
