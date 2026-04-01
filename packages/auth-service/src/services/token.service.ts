import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../config/database.js';
import { getPrivateKey, getPublicKey, getKeyId } from '../config/keys.js';
import type { AccessTokenPayload, RefreshTokenPayload, OIDCIdTokenPayload } from '@sada/shared';

const JWT_SECRET_RAW = process.env['JWT_SECRET'];
if (!JWT_SECRET_RAW || JWT_SECRET_RAW === 'default-secret') {
    if (process.env['NODE_ENV'] === 'production') {
        throw new Error('FATAL: JWT_SECRET must be set in production');
    }
    console.warn('[WARN] JWT_SECRET is not set or is default. Set JWT_SECRET for security.');
}

const ACCESS_TOKEN_EXPIRES = process.env['JWT_ACCESS_TOKEN_EXPIRES_IN'] ?? '15m';
const REFRESH_TOKEN_EXPIRES = process.env['JWT_REFRESH_TOKEN_EXPIRES_IN'] ?? '7d';
const OIDC_ISSUER = process.env['OIDC_ISSUER'] ?? 'http://localhost:3001';

function parseExpiresIn(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) return 3600;

    const value = parseInt(match[1]!, 10);
    const unit = match[2];

    switch (unit) {
        case 's': return value;
        case 'm': return value * 60;
        case 'h': return value * 3600;
        case 'd': return value * 86400;
        default: return 3600;
    }
}

export const tokenService = {
    /**
     * Generate RS256-signed access token
     */
    generateAccessToken(
        userId: string,
        type: 'user' | 'client',
        scopes: string[]
    ): { token: string; expiresAt: Date } {
        const expiresInSeconds = parseExpiresIn(ACCESS_TOKEN_EXPIRES);
        const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

        const payload: AccessTokenPayload = {
            sub: userId,
            type,
            scopes,
            exp: Math.floor(expiresAt.getTime() / 1000),
            iat: Math.floor(Date.now() / 1000),
        };

        const token = jwt.sign(payload, getPrivateKey(), {
            algorithm: 'RS256',
            header: { alg: 'RS256', kid: getKeyId() },
        } as jwt.SignOptions);

        return { token, expiresAt };
    },

    /**
     * Generate RS256-signed refresh token
     */
    generateRefreshToken(
        userId: string,
        type: 'user' | 'client'
    ): { token: string; expiresAt: Date; jti: string } {
        const expiresInSeconds = parseExpiresIn(REFRESH_TOKEN_EXPIRES);
        const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
        const jti = crypto.randomUUID();

        const payload: RefreshTokenPayload = {
            sub: userId,
            type,
            jti,
            exp: Math.floor(expiresAt.getTime() / 1000),
            iat: Math.floor(Date.now() / 1000),
        };

        const token = jwt.sign(payload, getPrivateKey(), {
            algorithm: 'RS256',
            header: { alg: 'RS256', kid: getKeyId() },
        } as jwt.SignOptions);

        return { token, expiresAt, jti };
    },

    /**
     * Generate RS256-signed OIDC ID token
     */
    generateIdToken(params: {
        userId: string;
        clientId: string;
        nonce?: string;
        scopes: string[];
        userInfo: { email: string; name: string; email_verified?: boolean };
    }): string {
        const now = Math.floor(Date.now() / 1000);
        const payload: OIDCIdTokenPayload = {
            iss: OIDC_ISSUER,
            sub: params.userId,
            aud: params.clientId,
            exp: now + 3600,
            iat: now,
            nonce: params.nonce,
        };

        if (params.scopes.includes('profile')) {
            payload.name = params.userInfo.name;
            payload.preferred_username = params.userInfo.email.split('@')[0];
        }

        if (params.scopes.includes('email')) {
            payload.email = params.userInfo.email;
            payload.email_verified = params.userInfo.email_verified ?? false;
        }

        return jwt.sign(payload, getPrivateKey(), {
            algorithm: 'RS256',
            header: { alg: 'RS256', kid: getKeyId() },
        } as jwt.SignOptions);
    },

    /**
     * Verify and decode token using RS256 public key
     */
    verifyToken<T extends AccessTokenPayload | RefreshTokenPayload>(token: string): T {
        return jwt.verify(token, getPublicKey(), { algorithms: ['RS256'] }) as T;
    },

    /**
     * Generate authorization code
     */
    generateAuthorizationCode(): string {
        return crypto.randomBytes(32).toString('hex');
    },

    /**
     * Generate client credentials
     */
    generateClientCredentials(): { clientId: string; clientSecret: string } {
        return {
            clientId: crypto.randomBytes(16).toString('hex'),
            clientSecret: crypto.randomBytes(32).toString('hex'),
        };
    },

    /**
     * Store token in database
     */
    async storeToken(data: {
        accessToken: string;
        refreshToken?: string;
        accessTokenExpiresAt: Date;
        refreshTokenExpiresAt?: Date;
        scopes: string[];
        userId?: string;
        clientId: string;
    }) {
        return prisma.oAuthToken.create({
            data: {
                accessToken: data.accessToken,
                refreshToken: data.refreshToken,
                accessTokenExpiresAt: data.accessTokenExpiresAt,
                refreshTokenExpiresAt: data.refreshTokenExpiresAt,
                scopes: data.scopes,
                userId: data.userId,
                clientId: data.clientId,
            },
        });
    },

    /**
     * Revoke token
     */
    async revokeToken(token: string): Promise<boolean> {
        const result = await prisma.oAuthToken.deleteMany({
            where: {
                OR: [
                    { accessToken: token },
                    { refreshToken: token },
                ],
            },
        });
        return result.count > 0;
    },

    /**
     * Clean up expired tokens
     */
    async cleanupExpiredTokens(): Promise<number> {
        const result = await prisma.oAuthToken.deleteMany({
            where: {
                accessTokenExpiresAt: {
                    lt: new Date(),
                },
            },
        });
        return result.count;
    },
};
