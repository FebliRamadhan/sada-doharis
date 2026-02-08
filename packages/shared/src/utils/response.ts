import type { Response } from 'express';
import type { ApiResponse, ApiError, ApiMeta } from '../types/index.js';

/**
 * Send success response
 */
export function sendSuccess<T>(
    res: Response,
    data: T,
    statusCode: number = 200,
    meta?: ApiMeta
): Response {
    const response: ApiResponse<T> = {
        success: true,
        data,
        meta,
    };
    return res.status(statusCode).json(response);
}

/**
 * Send error response
 */
export function sendError(
    res: Response,
    code: string,
    message: string,
    statusCode: number = 400,
    details?: Record<string, unknown>
): Response {
    const response: ApiResponse = {
        success: false,
        error: {
            code,
            message,
            details,
            requestId: res.locals['requestId'] as string | undefined,
        },
    };
    return res.status(statusCode).json(response);
}

/**
 * Send paginated response
 */
export function sendPaginated<T>(
    res: Response,
    data: T[],
    page: number,
    limit: number,
    total: number
): Response {
    const totalPages = Math.ceil(total / limit);

    const response: ApiResponse<T[]> = {
        success: true,
        data,
        meta: {
            page,
            limit,
            total,
            totalPages,
        },
    };
    return res.status(200).json(response);
}

// Error codes
export const ErrorCodes = {
    // Auth errors
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',
    TOKEN_INVALID: 'TOKEN_INVALID',

    // OAuth errors
    INVALID_CLIENT: 'INVALID_CLIENT',
    INVALID_GRANT: 'INVALID_GRANT',
    INVALID_SCOPE: 'INVALID_SCOPE',
    INVALID_REDIRECT_URI: 'INVALID_REDIRECT_URI',
    ACCESS_DENIED: 'ACCESS_DENIED',

    // Validation errors
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    BAD_REQUEST: 'BAD_REQUEST',

    // Resource errors
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',

    // Server errors
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];
