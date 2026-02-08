import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { oauthService } from '../services/oauth.service.js';
import { sendSuccess, sendError, ValidationError, ErrorCodes } from '@sada/shared';

const router = Router();

// Validation schemas
const authorizeSchema = z.object({
    response_type: z.literal('code'),
    client_id: z.string().min(1),
    redirect_uri: z.string().url(),
    scope: z.string().optional(),
    state: z.string().optional(),
    code_challenge: z.string().optional(),
    code_challenge_method: z.enum(['plain', 'S256']).optional(),
});

const tokenSchema = z.object({
    grant_type: z.enum(['authorization_code', 'client_credentials', 'refresh_token']),
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
    code: z.string().optional(),
    redirect_uri: z.string().optional(),
    code_verifier: z.string().optional(),
    refresh_token: z.string().optional(),
    scope: z.string().optional(),
});

const revokeSchema = z.object({
    token: z.string().min(1),
});

/**
 * @swagger
 * /oauth/authorize:
 *   get:
 *     summary: OAuth 2.0 Authorization Endpoint
 *     description: Initiates the OAuth 2.0 authorization code flow. Requires user to be authenticated.
 *     tags: [OAuth]
 *     parameters:
 *       - in: query
 *         name: response_type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [code]
 *         description: Must be 'code' for authorization code flow
 *       - in: query
 *         name: client_id
 *         required: true
 *         schema:
 *           type: string
 *         description: The client ID of the OAuth application
 *       - in: query
 *         name: redirect_uri
 *         required: true
 *         schema:
 *           type: string
 *           format: uri
 *         description: Callback URL to redirect to after authorization
 *       - in: query
 *         name: scope
 *         schema:
 *           type: string
 *         description: Space-separated list of requested scopes
 *         example: "openid profile email"
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         description: CSRF protection state parameter
 *       - in: query
 *         name: code_challenge
 *         schema:
 *           type: string
 *         description: PKCE code challenge (recommended for public clients)
 *       - in: query
 *         name: code_challenge_method
 *         schema:
 *           type: string
 *           enum: [plain, S256]
 *         description: PKCE code challenge method
 *     responses:
 *       302:
 *         description: Redirects to client's redirect_uri with authorization code
 *       400:
 *         description: Invalid request parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: User not authenticated - redirects to login
 */
router.get('/authorize', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = authorizeSchema.safeParse(req.query);

        if (!parsed.success) {
            throw new ValidationError('Invalid request', parsed.error.flatten().fieldErrors);
        }

        const { client_id, redirect_uri, scope, state, code_challenge, code_challenge_method } = parsed.data;

        // For now, we require the user to be authenticated via /auth/login first
        // In a real app, you'd show a login/consent form here
        const userId = req.headers['x-user-id'] as string;

        if (!userId) {
            // Redirect to login with return URL
            const returnUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
            return res.redirect(`/auth/login?return_url=${encodeURIComponent(returnUrl)}`);
        }

        const result = await oauthService.generateAuthorizationCode({
            clientId: client_id,
            userId,
            redirectUri: redirect_uri,
            scopes: scope?.split(' ') ?? [],
            codeChallenge: code_challenge,
            codeChallengeMethod: code_challenge_method,
        });

        // Redirect back to client with code
        const redirectUrl = new URL(redirect_uri);
        redirectUrl.searchParams.set('code', result.code);
        if (state) {
            redirectUrl.searchParams.set('state', state);
        }

        res.redirect(redirectUrl.toString());
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /oauth/token:
 *   post:
 *     summary: OAuth 2.0 Token Endpoint
 *     description: Exchange authorization code for tokens, or use client credentials grant
 *     tags: [OAuth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [grant_type, client_id, client_secret]
 *             properties:
 *               grant_type:
 *                 type: string
 *                 enum: [authorization_code, client_credentials, refresh_token]
 *                 description: The grant type being used
 *               client_id:
 *                 type: string
 *                 description: Client ID
 *               client_secret:
 *                 type: string
 *                 description: Client secret
 *               code:
 *                 type: string
 *                 description: Authorization code (required for authorization_code grant)
 *               redirect_uri:
 *                 type: string
 *                 description: Redirect URI (required for authorization_code grant)
 *               code_verifier:
 *                 type: string
 *                 description: PKCE code verifier (required if code_challenge was used)
 *               refresh_token:
 *                 type: string
 *                 description: Refresh token (required for refresh_token grant)
 *               scope:
 *                 type: string
 *                 description: Requested scopes (for refresh_token grant)
 *         application/json:
 *           schema:
 *             type: object
 *             required: [grant_type, client_id, client_secret]
 *             properties:
 *               grant_type:
 *                 type: string
 *                 enum: [authorization_code, client_credentials, refresh_token]
 *               client_id:
 *                 type: string
 *               client_secret:
 *                 type: string
 *               code:
 *                 type: string
 *               redirect_uri:
 *                 type: string
 *               code_verifier:
 *                 type: string
 *               refresh_token:
 *                 type: string
 *               scope:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token response
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenResponse'
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Invalid client credentials
 */
router.post('/token', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = tokenSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new ValidationError('Invalid request', parsed.error.flatten().fieldErrors);
        }

        const { grant_type, client_id, client_secret, code, redirect_uri, code_verifier, refresh_token, scope } = parsed.data;

        let result;

        switch (grant_type) {
            case 'authorization_code':
                if (!code || !redirect_uri) {
                    throw new ValidationError('code and redirect_uri are required');
                }
                result = await oauthService.exchangeAuthorizationCode({
                    code,
                    clientId: client_id,
                    clientSecret: client_secret,
                    redirectUri: redirect_uri,
                    codeVerifier: code_verifier,
                });
                break;

            case 'client_credentials':
                result = await oauthService.clientCredentialsGrant({
                    clientId: client_id,
                    clientSecret: client_secret,
                    scopes: scope?.split(' ') ?? [],
                });
                break;

            case 'refresh_token':
                if (!refresh_token) {
                    throw new ValidationError('refresh_token is required');
                }
                result = await oauthService.refreshTokenGrant({
                    refreshToken: refresh_token,
                    clientId: client_id,
                    clientSecret: client_secret,
                });
                break;

            default:
                throw new ValidationError('Unsupported grant type');
        }

        res.json(result);
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /oauth/revoke:
 *   post:
 *     summary: Revoke Token
 *     description: Revoke an access or refresh token
 *     tags: [OAuth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 *                 description: The token to revoke
 *     responses:
 *       200:
 *         description: Token revoked successfully
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
 *                     revoked:
 *                       type: boolean
 *       400:
 *         description: Invalid request
 */
router.post('/revoke', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = revokeSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new ValidationError('Invalid request', parsed.error.flatten().fieldErrors);
        }

        await oauthService.revokeToken(parsed.data.token);

        sendSuccess(res, { revoked: true });
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /oauth/.well-known/openid-configuration:
 *   get:
 *     summary: OpenID Connect Discovery
 *     description: Returns OpenID Connect discovery document with supported endpoints and capabilities
 *     tags: [OAuth]
 *     responses:
 *       200:
 *         description: OpenID Connect configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 issuer:
 *                   type: string
 *                   format: uri
 *                 authorization_endpoint:
 *                   type: string
 *                   format: uri
 *                 token_endpoint:
 *                   type: string
 *                   format: uri
 *                 revocation_endpoint:
 *                   type: string
 *                   format: uri
 *                 grant_types_supported:
 *                   type: array
 *                   items:
 *                     type: string
 *                 response_types_supported:
 *                   type: array
 *                   items:
 *                     type: string
 *                 token_endpoint_auth_methods_supported:
 *                   type: array
 *                   items:
 *                     type: string
 *                 code_challenge_methods_supported:
 *                   type: array
 *                   items:
 *                     type: string
 */
router.get('/.well-known/openid-configuration', (req: Request, res: Response) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    res.json({
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        revocation_endpoint: `${baseUrl}/oauth/revoke`,
        grant_types_supported: ['authorization_code', 'client_credentials', 'refresh_token'],
        response_types_supported: ['code'],
        token_endpoint_auth_methods_supported: ['client_secret_post'],
        code_challenge_methods_supported: ['plain', 'S256'],
    });
});

export { router as oauthRoutes };
