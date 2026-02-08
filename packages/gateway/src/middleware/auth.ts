import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UnauthorizedError, type AccessTokenPayload } from '@sada/shared';

const JWT_SECRET = process.env['JWT_SECRET'] ?? 'default-secret';

declare global {
    namespace Express {
        interface Request {
            user?: AccessTokenPayload;
        }
    }
}

/**
 * Verify Bearer token and attach user to request
 */
export function authMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction
): void {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader?.startsWith('Bearer ')) {
            throw new UnauthorizedError('Missing or invalid authorization header');
        }

        const token = authHeader.substring(7);
        const payload = jwt.verify(token, JWT_SECRET) as AccessTokenPayload;

        req.user = payload;
        next();
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            next(new UnauthorizedError('Invalid token'));
            return;
        }
        if (error instanceof jwt.TokenExpiredError) {
            next(new UnauthorizedError('Token expired'));
            return;
        }
        next(error);
    }
}

/**
 * Optional auth - don't throw if no token
 */
export function optionalAuth(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
        next();
        return;
    }

    authMiddleware(req, res, next);
}

/**
 * Check if user has required scopes
 */
export function requireScopes(...requiredScopes: string[]) {
    return (req: Request, _res: Response, next: NextFunction): void => {
        if (!req.user) {
            next(new UnauthorizedError('Authentication required'));
            return;
        }

        const userScopes = req.user.scopes ?? [];
        const hasAllScopes = requiredScopes.every(scope => userScopes.includes(scope));

        if (!hasAllScopes) {
            next(new UnauthorizedError(`Missing required scopes: ${requiredScopes.join(', ')}`));
            return;
        }

        next();
    };
}
