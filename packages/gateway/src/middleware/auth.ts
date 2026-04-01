import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UnauthorizedError, type AccessTokenPayload } from '@sada/shared';
import { getRedis } from '../config/redis.js';
import { getVerificationKey } from '../config/jwks.js';

declare global {
    namespace Express {
        interface Request {
            user?: AccessTokenPayload;
        }
    }
}

/**
 * Verify RS256 Bearer token, check Redis blacklist, attach user to request
 */
export async function authMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader?.startsWith('Bearer ')) {
            throw new UnauthorizedError('Missing or invalid authorization header');
        }

        const token = authHeader.substring(7);

        // Decode header to get kid for key lookup
        const decoded = jwt.decode(token, { complete: true });
        const kid = (decoded?.header as { kid?: string })?.kid;

        const publicKey = await getVerificationKey(kid);
        const payload = jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as AccessTokenPayload;

        // Check Redis token blacklist (enforces revocation before JWT expiry)
        try {
            const redis = getRedis();
            const isBlacklisted = await redis.get(`blacklist:${token}`);
            if (isBlacklisted) {
                throw new UnauthorizedError('Token has been revoked');
            }
        } catch (redisError) {
            if (redisError instanceof UnauthorizedError) throw redisError;
            // Redis unavailable — log and continue to avoid full outage
            console.error('[WARN] Redis blacklist check failed:', (redisError as Error).message);
        }

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
 * Optional auth — don't throw if no token
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
