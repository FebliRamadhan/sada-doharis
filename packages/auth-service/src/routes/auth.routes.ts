import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { z } from 'zod';
import crypto from 'crypto';
import { userService } from '../services/user.service.js';
import { tokenService } from '../services/token.service.js';
import { splpService } from '../services/splp.service.js';
import { ldapService } from '../services/ldap.service.js';
import { sessionService } from '../services/session.service.js';
import { prisma } from '../config/database.js';
import { getRedis } from '../config/redis.js';
import { sendSuccess, sendError, ValidationError } from '@sada/shared';
import { auditService, AUDIT_ACTIONS } from '../services/audit.service.js';
import { isAdminEmail } from '../middleware/adminGuard.js';

const router = Router();

// Lazy-cached system client id to avoid per-request DB lookups
let systemClientId: string | null = null;
async function getSystemClientId(): Promise<string> {
    if (!systemClientId) {
        const client = await prisma.oAuthClient.findUnique({
            where: { clientId: 'system-internal' },
            select: { id: true },
        });
        if (!client) throw new Error('System OAuth client not found');
        systemClientId = client.id;
    }
    return systemClientId;
}

// Validation schemas
const loginSchema = z.object({
    email: z.string().min(1), // accept email or username/NIP
    password: z.string().min(1),
});

const ldapLoginSchema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
});

const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1),
});

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login with email/password
 *     description: Authenticate user with email and password, returns JWT tokens
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "user@example.com"
 *               password:
 *                 type: string
 *                 format: password
 *                 example: "password123"
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     access_token:
 *                       type: string
 *                     token_type:
 *                       type: string
 *                       example: "Bearer"
 *                     expires_in:
 *                       type: integer
 *                     refresh_token:
 *                       type: string
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = loginSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new ValidationError('Invalid request', parsed.error.flatten().fieldErrors);
        }

        const user = await userService.loginWithPassword(parsed.data.email, parsed.data.password);

        // Generate tokens
        const scopes = ['profile', 'email'];
        const accessToken = tokenService.generateAccessToken(user.id, 'user', scopes);
        const refreshToken = tokenService.generateRefreshToken(user.id, 'user');

        await tokenService.storeToken({
            accessToken: accessToken.token,
            refreshToken: refreshToken.token,
            accessTokenExpiresAt: accessToken.expiresAt,
            refreshTokenExpiresAt: refreshToken.expiresAt,
            scopes,
            userId: user.id,
            clientId: await getSystemClientId(),
        });

        void auditService.log({
            action: AUDIT_ACTIONS.LOGIN,
            userId: user.id,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
        });

        await sessionService.create(res, user.id);

        sendSuccess(res, {
            user: { ...user, isAdmin: isAdminEmail(user.email) },
            access_token: accessToken.token,
            token_type: 'Bearer',
            expires_in: Math.floor((accessToken.expiresAt.getTime() - Date.now()) / 1000),
            refresh_token: refreshToken.token,
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /auth/ldap/login:
 *   post:
 *     summary: Login with LDAP credentials
 *     description: Authenticate internal users via LDAP (Active Directory)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username:
 *                 type: string
 *                 description: LDAP username/uid
 *                 example: "john.doe"
 *               password:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     access_token:
 *                       type: string
 *                     token_type:
 *                       type: string
 *                     expires_in:
 *                       type: integer
 *                     refresh_token:
 *                       type: string
 *       400:
 *         description: LDAP not configured
 *       401:
 *         description: Invalid credentials
 */
router.post('/ldap/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!ldapService.isConfigured()) {
            throw new ValidationError('LDAP is not configured');
        }

        const parsed = ldapLoginSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new ValidationError('Invalid request', parsed.error.flatten().fieldErrors);
        }

        const user = await userService.loginWithLdap(parsed.data.username, parsed.data.password);

        // Generate tokens
        const scopes = ['profile', 'email', 'internal'];
        const accessToken = tokenService.generateAccessToken(user.id, 'user', scopes);
        const refreshToken = tokenService.generateRefreshToken(user.id, 'user');

        await tokenService.storeToken({
            accessToken: accessToken.token,
            refreshToken: refreshToken.token,
            accessTokenExpiresAt: accessToken.expiresAt,
            refreshTokenExpiresAt: refreshToken.expiresAt,
            scopes,
            userId: user.id,
            clientId: await getSystemClientId(),
        });

        await sessionService.create(res, user.id);

        sendSuccess(res, {
            user: { ...user, isAdmin: isAdminEmail(user.email) },
            access_token: accessToken.token,
            token_type: 'Bearer',
            expires_in: Math.floor((accessToken.expiresAt.getTime() - Date.now()) / 1000),
            refresh_token: refreshToken.token,
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /auth/splp/authorize:
 *   get:
 *     summary: Redirect to SPLP SSO
 *     description: Initiates government SSO via SPLP (Sistem Penghubung Layanan Pemerintah)
 *     tags: [Auth]
 *     responses:
 *       302:
 *         description: Redirect to SPLP authorization page
 *       400:
 *         description: SPLP not configured
 */
router.get('/splp/authorize', async (req: Request, res: Response): Promise<void> => {
    if (!splpService.isConfigured()) {
        sendError(res, 'NOT_CONFIGURED', 'SPLP is not configured', 400);
        return;
    }

    const state = crypto.randomBytes(16).toString('hex');
    const redis = getRedis();
    await redis.setex(`splp_state:${state}`, 600, 'valid');

    const authUrl = splpService.getAuthorizationUrl(state);
    res.redirect(authUrl);
});

/**
 * @swagger
 * /auth/splp/callback:
 *   get:
 *     summary: SPLP OAuth callback
 *     description: Exchange SPLP authorization code for tokens
 *     tags: [Auth]
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Authorization code from SPLP
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         description: CSRF state parameter
 *     responses:
 *       200:
 *         description: Authentication successful
 *       400:
 *         description: Invalid or missing authorization code
 */
router.get('/splp/callback', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { code, state, error } = req.query;

        if (error) {
            throw new ValidationError(`SPLP error: ${error}`);
        }

        if (!code || typeof code !== 'string') {
            throw new ValidationError('Missing authorization code');
        }

        // Verify CSRF state
        if (!state || typeof state !== 'string') {
            throw new ValidationError('Missing state parameter');
        }
        const redis = getRedis();
        const storedState = await redis.get(`splp_state:${state}`);
        if (!storedState) {
            throw new ValidationError('Invalid or expired state parameter');
        }
        await redis.del(`splp_state:${state}`);

        const user = await userService.loginWithSplp(code);

        // Generate tokens
        const scopes = ['profile', 'email', 'government'];
        const accessToken = tokenService.generateAccessToken(user.id, 'user', scopes);
        const refreshToken = tokenService.generateRefreshToken(user.id, 'user');

        await tokenService.storeToken({
            accessToken: accessToken.token,
            refreshToken: refreshToken.token,
            accessTokenExpiresAt: accessToken.expiresAt,
            refreshTokenExpiresAt: refreshToken.expiresAt,
            scopes,
            userId: user.id,
            clientId: await getSystemClientId(),
        });

        await sessionService.create(res, user.id);

        sendSuccess(res, {
            user: { ...user, isAdmin: isAdminEmail(user.email) },
            access_token: accessToken.token,
            token_type: 'Bearer',
            expires_in: Math.floor((accessToken.expiresAt.getTime() - Date.now()) / 1000),
            refresh_token: refreshToken.token,
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register new user
 *     description: Create a new user account with email and password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, name]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "newuser@example.com"
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 example: "securepassword123"
 *               name:
 *                 type: string
 *                 example: "John Doe"
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     access_token:
 *                       type: string
 *                     token_type:
 *                       type: string
 *                     expires_in:
 *                       type: integer
 *                     refresh_token:
 *                       type: string
 *       409:
 *         description: Email already registered
 */
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = registerSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new ValidationError('Invalid request', parsed.error.flatten().fieldErrors);
        }

        const user = await userService.register(parsed.data);

        // Generate tokens
        const scopes = ['profile', 'email'];
        const accessToken = tokenService.generateAccessToken(user.id, 'user', scopes);
        const refreshToken = tokenService.generateRefreshToken(user.id, 'user');

        await tokenService.storeToken({
            accessToken: accessToken.token,
            refreshToken: refreshToken.token,
            accessTokenExpiresAt: accessToken.expiresAt,
            refreshTokenExpiresAt: refreshToken.expiresAt,
            scopes,
            userId: user.id,
            clientId: await getSystemClientId(),
        });

        void auditService.log({
            action: AUDIT_ACTIONS.REGISTER,
            userId: user.id,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
        });

        await sessionService.create(res, user.id);

        sendSuccess(res, {
            user: { ...user, isAdmin: isAdminEmail(user.email) },
            access_token: accessToken.token,
            token_type: 'Bearer',
            expires_in: Math.floor((accessToken.expiresAt.getTime() - Date.now()) / 1000),
            refresh_token: refreshToken.token,
        }, 201);
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /auth/google:
 *   get:
 *     summary: Initiate Google OAuth
 *     description: Redirect to Google for authentication
 *     tags: [Auth]
 *     responses:
 *       302:
 *         description: Redirect to Google OAuth consent screen
 */
router.get('/google', passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
}));

/**
 * @swagger
 * /auth/google/callback:
 *   get:
 *     summary: Google OAuth callback
 *     description: Handle Google OAuth callback and redirect with tokens
 *     tags: [Auth]
 *     responses:
 *       302:
 *         description: Redirect to frontend with tokens
 *       401:
 *         description: Authentication failed
 */
router.get('/google/callback',
    passport.authenticate('google', { session: false, failureRedirect: '/auth/login' }),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user as { id: string };
            const scopes = ['profile', 'email'];
            const accessToken = tokenService.generateAccessToken(user.id, 'user', scopes);
            const refreshToken = tokenService.generateRefreshToken(user.id, 'user');

            await tokenService.storeToken({
                accessToken: accessToken.token,
                refreshToken: refreshToken.token,
                accessTokenExpiresAt: accessToken.expiresAt,
                refreshTokenExpiresAt: refreshToken.expiresAt,
                scopes,
                userId: user.id,
                clientId: await getSystemClientId(),
            });

            await sessionService.create(res, user.id);

            const frontendUrl = process.env['FRONTEND_URL'] ?? 'http://localhost:3000';
            const redirectUrl = new URL('/auth/callback', frontendUrl);
            redirectUrl.searchParams.set('access_token', accessToken.token);
            redirectUrl.searchParams.set('refresh_token', refreshToken.token);

            res.redirect(redirectUrl.toString());
        } catch (error) {
            next(error);
        }
    }
);

/**
 * @swagger
 * /auth/facebook:
 *   get:
 *     summary: Initiate Facebook OAuth
 *     description: Redirect to Facebook for authentication
 *     tags: [Auth]
 *     responses:
 *       302:
 *         description: Redirect to Facebook OAuth consent screen
 */
router.get('/facebook', passport.authenticate('facebook', {
    scope: ['email'],
    session: false,
}));

/**
 * @swagger
 * /auth/facebook/callback:
 *   get:
 *     summary: Facebook OAuth callback
 *     description: Handle Facebook OAuth callback and redirect with tokens
 *     tags: [Auth]
 *     responses:
 *       302:
 *         description: Redirect to frontend with tokens
 *       401:
 *         description: Authentication failed
 */
router.get('/facebook/callback',
    passport.authenticate('facebook', { session: false, failureRedirect: '/auth/login' }),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user as { id: string };
            const scopes = ['profile', 'email'];
            const accessToken = tokenService.generateAccessToken(user.id, 'user', scopes);
            const refreshToken = tokenService.generateRefreshToken(user.id, 'user');

            await tokenService.storeToken({
                accessToken: accessToken.token,
                refreshToken: refreshToken.token,
                accessTokenExpiresAt: accessToken.expiresAt,
                refreshTokenExpiresAt: refreshToken.expiresAt,
                scopes,
                userId: user.id,
                clientId: await getSystemClientId(),
            });

            await sessionService.create(res, user.id);

            const frontendUrl = process.env['FRONTEND_URL'] ?? 'http://localhost:3000';
            const redirectUrl = new URL('/auth/callback', frontendUrl);
            redirectUrl.searchParams.set('access_token', accessToken.token);
            redirectUrl.searchParams.set('refresh_token', refreshToken.token);

            res.redirect(redirectUrl.toString());
        } catch (error) {
            next(error);
        }
    }
);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get current user info
 *     description: Returns the currently authenticated user's profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Not authenticated
 */
/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout (destroys SSO session)
 *     description: Destroys the auth-service SSO session and clears the session cookie.
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Logged out
 */
router.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
    try {
        await sessionService.destroy(req, res);
        sendSuccess(res, { logged_out: true });
    } catch (error) {
        next(error);
    }
});

router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
    try {
        // x-user-id is set by the API gateway in production
        // Fall back to Bearer token verification for direct / local-dev access,
        // and finally to the SSO session cookie so a fresh tab without sessionStorage
        // can still recognise the user.
        let userId = req.headers['x-user-id'] as string | undefined;

        if (!userId) {
            const authHeader = req.headers['authorization'];
            if (authHeader?.startsWith('Bearer ')) {
                const payload = tokenService.verifyToken(authHeader.slice(7));
                if (payload?.sub) {
                    userId = payload.sub;
                }
            }
        }

        if (!userId) {
            const sessionUserId = await sessionService.getUserId(req);
            if (sessionUserId) userId = sessionUserId;
        }

        if (!userId) {
            throw new ValidationError('Not authenticated');
        }

        const user = await userService.findById(userId);
        sendSuccess(res, { ...user, isAdmin: isAdminEmail(user.email) });
    } catch (error) {
        next(error);
    }
});

export { router as authRoutes };
