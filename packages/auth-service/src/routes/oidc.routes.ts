import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { tokenService } from '../services/token.service.js';
import { clientService } from '../services/client.service.js';
import { sessionService } from '../services/session.service.js';
import { getJWKS, getPublicKey } from '../config/keys.js';
import { getRedis } from '../config/redis.js';
import {
    sendSuccess,
    sendError,
    ValidationError,
    UnauthorizedError,
    type AccessTokenPayload,
    type OIDCUserInfoResponse,
    type TokenIntrospectionResponse,
} from '@sada/shared';

const router = Router();

// ================================================
// GET /.well-known/jwks.json
// ================================================
/**
 * @swagger
 * /.well-known/jwks.json:
 *   get:
 *     summary: JSON Web Key Set
 *     description: Returns public keys for RS256 token verification
 *     tags: [OIDC]
 *     responses:
 *       200:
 *         description: JWKS response
 */
router.get('/.well-known/jwks.json', (_req: Request, res: Response) => {
    res.json(getJWKS());
});

// ================================================
// GET /oauth/userinfo
// ================================================
/**
 * @swagger
 * /oauth/userinfo:
 *   get:
 *     summary: UserInfo Endpoint (OIDC Core §5.3)
 *     description: Returns claims about the authenticated user based on token scopes
 *     tags: [OIDC]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User claims
 *       401:
 *         description: Invalid or missing token
 */
router.get('/userinfo', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            throw new UnauthorizedError('Missing Bearer token');
        }

        const token = authHeader.substring(7);
        let payload: AccessTokenPayload;
        try {
            payload = tokenService.verifyToken<AccessTokenPayload>(token);
        } catch {
            throw new UnauthorizedError('Invalid or expired token');
        }

        if (payload.type !== 'user') {
            throw new UnauthorizedError('UserInfo requires a user token');
        }

        const user = await prisma.user.findUnique({
            where: { id: payload.sub },
            select: { id: true, email: true, name: true, isActive: true },
        });

        if (!user || !user.isActive) {
            throw new UnauthorizedError('User not found or inactive');
        }

        const response: OIDCUserInfoResponse = { sub: user.id };

        if (payload.scopes.includes('profile')) {
            response.name = user.name;
            response.preferred_username = user.email.split('@')[0];
        }

        if (payload.scopes.includes('email')) {
            response.email = user.email;
            response.email_verified = false; // Extend when email verification is implemented
        }

        res.json(response);
    } catch (error) {
        next(error);
    }
});

// ================================================
// POST /oauth/introspect (RFC 7662)
// ================================================
const introspectSchema = z.object({
    token: z.string().min(1),
    token_type_hint: z.enum(['access_token', 'refresh_token']).optional(),
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
});

/**
 * @swagger
 * /oauth/introspect:
 *   post:
 *     summary: Token Introspection (RFC 7662)
 *     description: Returns metadata about a token. Returns { active: false } for invalid tokens.
 *     tags: [OIDC]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, client_id, client_secret]
 *             properties:
 *               token:
 *                 type: string
 *               client_id:
 *                 type: string
 *               client_secret:
 *                 type: string
 *               token_type_hint:
 *                 type: string
 *                 enum: [access_token, refresh_token]
 *     responses:
 *       200:
 *         description: Token introspection result
 */
router.post('/introspect', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = introspectSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new ValidationError('Invalid request', parsed.error.flatten().fieldErrors);
        }

        const { token, client_id, client_secret } = parsed.data;

        // Require client authentication
        const client = await clientService.validateCredentials(client_id, client_secret);
        if (!client) {
            sendError(res, 'INVALID_CLIENT', 'Invalid client credentials', 401);
            return;
        }

        // Try to verify the token
        let payload: AccessTokenPayload;
        try {
            payload = tokenService.verifyToken<AccessTokenPayload>(token);
        } catch {
            res.json({ active: false } satisfies TokenIntrospectionResponse);
            return;
        }

        // Check DB — token might be revoked
        const storedToken = await prisma.oAuthToken.findFirst({
            where: { accessToken: token },
        });

        if (!storedToken) {
            res.json({ active: false } satisfies TokenIntrospectionResponse);
            return;
        }

        const response: TokenIntrospectionResponse = {
            active: true,
            sub: payload.sub,
            scope: payload.scopes.join(' '),
            client_id,
            token_type: 'Bearer',
            exp: payload.exp,
            iat: payload.iat,
        };

        res.json(response);
    } catch (error) {
        next(error);
    }
});

// ================================================
// GET /oauth/logout (OIDC Session §5)
// ================================================
/**
 * @swagger
 * /oauth/logout:
 *   get:
 *     summary: End Session Endpoint (OIDC Session §5)
 *     description: Revokes all tokens for the user and optionally redirects
 *     tags: [OIDC]
 *     parameters:
 *       - in: query
 *         name: id_token_hint
 *         schema:
 *           type: string
 *         description: Previously issued ID token
 *       - in: query
 *         name: post_logout_redirect_uri
 *         schema:
 *           type: string
 *         description: URI to redirect after logout
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Logged out successfully
 *       302:
 *         description: Redirect to post_logout_redirect_uri
 */
router.get('/logout', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id_token_hint, post_logout_redirect_uri, state } = req.query as Record<string, string | undefined>;

        let userId: string | undefined;

        // Extract user from id_token_hint — verify signature (ignoring expiry, as logout may use old tokens)
        if (id_token_hint) {
            try {
                const tokenPayload = jwt.verify(id_token_hint, getPublicKey(), {
                    algorithms: ['RS256'],
                    ignoreExpiration: true,
                }) as { sub?: string };
                userId = tokenPayload.sub;
            } catch {
                // Invalid signature — ignore, proceed with logout without user context
            }
        }

        if (userId) {
            // Find all active tokens for this user
            const tokens = await prisma.oAuthToken.findMany({
                where: { userId },
                select: { accessToken: true, accessTokenExpiresAt: true },
            });

            // Add to Redis blacklist before deleting from DB
            const redis = getRedis();
            await Promise.all(
                tokens.map(async (t) => {
                    const ttl = Math.floor((t.accessTokenExpiresAt.getTime() - Date.now()) / 1000);
                    if (ttl > 0) {
                        await redis.setex(`blacklist:${t.accessToken}`, ttl, '1');
                    }
                })
            );

            // Revoke all tokens
            await prisma.oAuthToken.deleteMany({ where: { userId } });

            // End every SSO session belonging to this user (global single sign-out)
            await sessionService.destroyAllForUser(userId);
        }

        // Always clear the cookie on this browser, even if we couldn't resolve a userId
        await sessionService.destroy(req, res);

        // Validate post_logout_redirect_uri against registered client URIs
        if (post_logout_redirect_uri) {
            const clientWithUri = await prisma.oAuthClient.findFirst({
                where: {
                    redirectUris: { has: post_logout_redirect_uri },
                    isActive: true,
                },
            });

            if (clientWithUri) {
                const redirectUrl = new URL(post_logout_redirect_uri);
                if (state) redirectUrl.searchParams.set('state', state);
                res.redirect(redirectUrl.toString());
                return;
            }
        }

        sendSuccess(res, { logged_out: true });
    } catch (error) {
        next(error);
    }
});

export { router as oidcRoutes };
