import { ErrorCodes, type ErrorCode } from './response.js';

/**
 * Base application error
 */
export class AppError extends Error {
    public readonly code: ErrorCode;
    public readonly statusCode: number;
    public readonly details?: Record<string, unknown>;
    public readonly isOperational: boolean;

    constructor(
        code: ErrorCode,
        message: string,
        statusCode: number = 400,
        details?: Record<string, unknown>
    ) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Validation error
 */
export class ValidationError extends AppError {
    constructor(message: string, details?: Record<string, unknown>) {
        super(ErrorCodes.VALIDATION_ERROR, message, 422, details);
    }
}

/**
 * Not found error
 */
export class NotFoundError extends AppError {
    constructor(resource: string, id?: string) {
        const message = id
            ? `${resource} with id '${id}' not found`
            : `${resource} not found`;
        super(ErrorCodes.NOT_FOUND, message, 404);
    }
}

/**
 * Unauthorized error
 */
export class UnauthorizedError extends AppError {
    constructor(message: string = 'Unauthorized') {
        super(ErrorCodes.UNAUTHORIZED, message, 401);
    }
}

/**
 * Forbidden error
 */
export class ForbiddenError extends AppError {
    constructor(message: string = 'Forbidden') {
        super(ErrorCodes.FORBIDDEN, message, 403);
    }
}

/**
 * Conflict error (e.g., duplicate resource)
 */
export class ConflictError extends AppError {
    constructor(message: string) {
        super(ErrorCodes.CONFLICT, message, 409);
    }
}

/**
 * OAuth-specific errors
 */
export class OAuthError extends AppError {
    public readonly errorType: string;

    constructor(
        errorType: string,
        message: string,
        code: ErrorCode = ErrorCodes.INVALID_GRANT
    ) {
        super(code, message, 400);
        this.errorType = errorType;
    }
}

/**
 * Invalid client error (OAuth)
 */
export class InvalidClientError extends OAuthError {
    constructor(message: string = 'Invalid client') {
        super('invalid_client', message, ErrorCodes.INVALID_CLIENT);
    }
}

/**
 * Invalid grant error (OAuth)
 */
export class InvalidGrantError extends OAuthError {
    constructor(message: string = 'Invalid grant') {
        super('invalid_grant', message, ErrorCodes.INVALID_GRANT);
    }
}

/**
 * Invalid scope error (OAuth)
 */
export class InvalidScopeError extends OAuthError {
    constructor(message: string = 'Invalid scope') {
        super('invalid_scope', message, ErrorCodes.INVALID_SCOPE);
    }
}
