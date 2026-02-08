import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../config/database.js';
import type { AccessTokenPayload, RefreshTokenPayload } from '@sada/shared';

const JWT_SECRET = process.env['JWT_SECRET'] ?? 'default-secret';
const ACCESS_TOKEN_EXPIRES = process.env['JWT_ACCESS_TOKEN_EXPIRES_IN'] ?? '15m';
const REFRESH_TOKEN_EXPIRES = process.env['JWT_REFRESH_TOKEN_EXPIRES_IN'] ?? '7d';

function parseExpiresIn(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) return 3600; // Default 1 hour

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
     * Generate access token for user
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

        const token = jwt.sign(payload, JWT_SECRET);

        return { token, expiresAt };
    },

    /**
     * Generate refresh token
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

        const token = jwt.sign(payload, JWT_SECRET);

        return { token, expiresAt, jti };
    },

    /**
     * Verify and decode token
     */
    verifyToken<T extends AccessTokenPayload | RefreshTokenPayload>(token: string): T {
        return jwt.verify(token, JWT_SECRET) as T;
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
