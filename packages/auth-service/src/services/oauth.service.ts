import crypto from 'crypto';
import { prisma } from '../config/database.js';
import { tokenService } from './token.service.js';
import { clientService } from './client.service.js';
import { getRedis } from '../config/redis.js';
import { auditService, AUDIT_ACTIONS } from './audit.service.js';
import {
    InvalidClientError,
    InvalidGrantError,
    InvalidScopeError,
    NotFoundError,
    createLogger
} from '@sada/shared';

const logger = createLogger('oauth-service');

const AUTH_CODE_EXPIRES = parseInt(
    process.env['OAUTH_AUTHORIZATION_CODE_EXPIRES_IN'] ?? '600',
    10
);

export const oauthService = {
    /**
     * Generate authorization code
     */
    async generateAuthorizationCode(data: {
        clientId: string;
        userId: string;
        redirectUri: string;
        scopes: string[];
        nonce?: string;
        codeChallenge?: string;
        codeChallengeMethod?: string;
    }) {
        // Validate client
        const client = await prisma.oAuthClient.findUnique({
            where: { clientId: data.clientId },
        });

        if (!client || !client.isActive) {
            throw new InvalidClientError('Invalid client');
        }

        // Validate redirect URI
        if (!client.redirectUris.includes(data.redirectUri)) {
            throw new InvalidClientError('Invalid redirect URI');
        }

        // Validate scopes
        const invalidScopes = data.scopes.filter(s => !client.scopes.includes(s));
        if (invalidScopes.length > 0) {
            throw new InvalidScopeError(`Invalid scopes: ${invalidScopes.join(', ')}`);
        }

        // Generate code
        const code = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + AUTH_CODE_EXPIRES * 1000);

        await prisma.oAuthAuthorizationCode.create({
            data: {
                code,
                redirectUri: data.redirectUri,
                scopes: data.scopes,
                expiresAt,
                nonce: data.nonce,
                codeChallenge: data.codeChallenge,
                codeChallengeMethod: data.codeChallengeMethod,
                userId: data.userId,
                clientId: client.id,
            },
        });

        logger.info('Authorization code generated', { clientId: data.clientId, userId: data.userId });

        return { code, expiresAt };
    },

    /**
     * Exchange authorization code for tokens
     */
    async exchangeAuthorizationCode(data: {
        code: string;
        clientId: string;
        clientSecret: string;
        redirectUri: string;
        codeVerifier?: string;
    }) {
        // Validate client using bcrypt comparison
        const client = await clientService.validateCredentials(data.clientId, data.clientSecret);
        if (!client) {
            throw new InvalidClientError('Invalid client credentials');
        }

        // Find authorization code
        const authCode = await prisma.oAuthAuthorizationCode.findUnique({
            where: { code: data.code },
            include: { user: true },
        });

        if (!authCode) {
            throw new InvalidGrantError('Invalid authorization code');
        }

        // Check expiration
        if (authCode.expiresAt < new Date()) {
            await prisma.oAuthAuthorizationCode.delete({ where: { id: authCode.id } });
            throw new InvalidGrantError('Authorization code expired');
        }

        // Validate redirect URI
        if (authCode.redirectUri !== data.redirectUri) {
            throw new InvalidGrantError('Redirect URI mismatch');
        }

        // Validate PKCE if present
        if (authCode.codeChallenge) {
            if (!data.codeVerifier) {
                throw new InvalidGrantError('Code verifier required');
            }

            const verified = this.verifyPKCE(
                data.codeVerifier,
                authCode.codeChallenge,
                authCode.codeChallengeMethod ?? 'S256'
            );

            if (!verified) {
                throw new InvalidGrantError('Invalid code verifier');
            }
        }

        // Delete used authorization code
        await prisma.oAuthAuthorizationCode.delete({ where: { id: authCode.id } });

        // Generate tokens
        const accessToken = tokenService.generateAccessToken(
            authCode.userId,
            'user',
            authCode.scopes
        );

        const refreshToken = tokenService.generateRefreshToken(authCode.userId, 'user');

        // Store tokens
        await tokenService.storeToken({
            accessToken: accessToken.token,
            refreshToken: refreshToken.token,
            accessTokenExpiresAt: accessToken.expiresAt,
            refreshTokenExpiresAt: refreshToken.expiresAt,
            scopes: authCode.scopes,
            userId: authCode.userId,
            clientId: client.id,
        });

        // Generate OIDC ID token if openid scope requested
        let id_token: string | undefined;
        if (authCode.scopes.includes('openid') && authCode.user) {
            id_token = tokenService.generateIdToken({
                userId: authCode.userId,
                clientId: data.clientId,
                nonce: authCode.nonce ?? undefined,
                scopes: authCode.scopes,
                userInfo: {
                    email: authCode.user.email,
                    name: authCode.user.name,
                },
            });
        }

        logger.info('Tokens issued via authorization code', {
            clientId: data.clientId,
            userId: authCode.userId
        });

        return {
            access_token: accessToken.token,
            token_type: 'Bearer',
            expires_in: Math.floor((accessToken.expiresAt.getTime() - Date.now()) / 1000),
            refresh_token: refreshToken.token,
            scope: authCode.scopes.join(' '),
            ...(id_token ? { id_token } : {}),
        };
    },

    /**
     * Client credentials grant
     */
    async clientCredentialsGrant(data: {
        clientId: string;
        clientSecret: string;
        scopes: string[];
    }) {
        // Validate client using bcrypt comparison
        const client = await clientService.validateCredentials(data.clientId, data.clientSecret);
        if (!client) {
            throw new InvalidClientError('Invalid client credentials');
        }

        if (!client.grants.includes('client_credentials')) {
            throw new InvalidGrantError('Client not authorized for this grant type');
        }

        // Validate scopes
        const requestedScopes = data.scopes.length > 0 ? data.scopes : client.scopes;
        const invalidScopes = requestedScopes.filter((s: string) => !client.scopes.includes(s));
        if (invalidScopes.length > 0) {
            throw new InvalidScopeError(`Invalid scopes: ${invalidScopes.join(', ')}`);
        }

        // Generate access token only (no refresh token for client credentials)
        const accessToken = tokenService.generateAccessToken(
            client.id,
            'client',
            requestedScopes
        );

        // Store token
        await tokenService.storeToken({
            accessToken: accessToken.token,
            accessTokenExpiresAt: accessToken.expiresAt,
            scopes: requestedScopes,
            clientId: client.id,
        });

        logger.info('Token issued via client credentials', { clientId: data.clientId });

        return {
            access_token: accessToken.token,
            token_type: 'Bearer',
            expires_in: Math.floor((accessToken.expiresAt.getTime() - Date.now()) / 1000),
            scope: requestedScopes.join(' '),
        };
    },

    /**
     * Refresh token grant
     */
    async refreshTokenGrant(data: {
        refreshToken: string;
        clientId: string;
        clientSecret: string;
    }) {
        // Validate client using bcrypt comparison
        const client = await clientService.validateCredentials(data.clientId, data.clientSecret);
        if (!client) {
            throw new InvalidClientError('Invalid client credentials');
        }

        // Find token
        const storedToken = await prisma.oAuthToken.findUnique({
            where: { refreshToken: data.refreshToken },
        });

        if (!storedToken) {
            throw new InvalidGrantError('Invalid refresh token');
        }

        if (storedToken.clientId !== client.id) {
            throw new InvalidGrantError('Refresh token does not belong to this client');
        }

        if (storedToken.refreshTokenExpiresAt && storedToken.refreshTokenExpiresAt < new Date()) {
            await prisma.oAuthToken.delete({ where: { id: storedToken.id } });
            throw new InvalidGrantError('Refresh token expired');
        }

        // Generate new tokens
        const type = storedToken.userId ? 'user' : 'client';
        const subjectId = storedToken.userId ?? storedToken.clientId;

        const accessToken = tokenService.generateAccessToken(
            subjectId,
            type,
            storedToken.scopes
        );

        const newRefreshToken = tokenService.generateRefreshToken(subjectId, type);

        // Update token in database
        await prisma.oAuthToken.update({
            where: { id: storedToken.id },
            data: {
                accessToken: accessToken.token,
                refreshToken: newRefreshToken.token,
                accessTokenExpiresAt: accessToken.expiresAt,
                refreshTokenExpiresAt: newRefreshToken.expiresAt,
            },
        });

        logger.info('Token refreshed', { clientId: data.clientId, userId: storedToken.userId });

        return {
            access_token: accessToken.token,
            token_type: 'Bearer',
            expires_in: Math.floor((accessToken.expiresAt.getTime() - Date.now()) / 1000),
            refresh_token: newRefreshToken.token,
            scope: storedToken.scopes.join(' '),
        };
    },

    /**
     * Revoke token — removes from DB and adds to Redis blacklist
     */
    async revokeToken(token: string): Promise<void> {
        await tokenService.revokeToken(token);

        // Add to Redis blacklist so gateway enforces revocation immediately
        try {
            const payload = tokenService.verifyToken(token);
            const ttl = payload.exp - Math.floor(Date.now() / 1000);
            if (ttl > 0) {
                const redis = getRedis();
                await redis.setex(`blacklist:${token}`, ttl, '1');
            }
        } catch {
            // Token may be expired/invalid — DB deletion is sufficient
        }

        void auditService.log({ action: AUDIT_ACTIONS.TOKEN_REVOKED });
        logger.info('Token revoked');
    },

    /**
     * Verify PKCE code verifier
     */
    verifyPKCE(verifier: string, challenge: string, method: string): boolean {
        if (method === 'plain') {
            return verifier === challenge;
        }

        // S256
        const hash = crypto
            .createHash('sha256')
            .update(verifier)
            .digest('base64url');

        return hash === challenge;
    },
};
