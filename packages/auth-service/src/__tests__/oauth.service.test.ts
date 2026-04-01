import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../config/database.js', () => ({
    prisma: {
        oAuthAuthorizationCode: {
            create: vi.fn(() => ({
                id: 'code-id',
                code: 'auth-code-123',
                expiresAt: new Date(Date.now() + 600000),
            })),
            findUnique: vi.fn(() => ({
                id: 'code-id',
                code: 'auth-code-123',
                clientId: 'client-123',
                userId: 'user-123',
                redirectUri: 'https://app.test/callback',
                scopes: ['openid', 'profile'],
                expiresAt: new Date(Date.now() + 600000),
                used: false,
                client: {
                    id: 'client-123',
                    secret: 'hashed-secret',
                },
            })),
            update: vi.fn(),
        },
        oAuthClient: {
            findUnique: vi.fn(() => ({
                id: 'client-123',
                clientId: 'client-123',
                secret: 'hashed-secret',
                isActive: true,
                redirectUris: ['https://app.test/callback'],
                scopes: ['openid', 'profile', 'email'],
                grants: ['authorization_code', 'client_credentials', 'refresh_token'],
            })),
            upsert: vi.fn(),
        },
        oAuthToken: {
            findFirst: vi.fn(() => ({
                id: 'token-id',
                refreshToken: 'refresh-token-123',
                userId: 'user-123',
                clientId: 'client-123',
                scopes: ['openid', 'profile'],
            })),
            create: vi.fn(),
            delete: vi.fn(),
        },
    },
}));

vi.mock('../services/client.service.js', () => ({
    clientService: {
        validateCredentials: vi.fn(() => ({
            id: 'client-123',
            clientId: 'client-123',
            isActive: true,
            redirectUris: ['https://app.test/callback'],
            scopes: ['openid', 'profile', 'email'],
            grants: ['authorization_code', 'client_credentials', 'refresh_token'],
        })),
    },
}));

vi.mock('../services/audit.service.js', () => ({
    auditService: { log: vi.fn() },
    AUDIT_ACTIONS: { TOKEN_REVOKED: 'TOKEN_REVOKED' },
}));

vi.mock('../config/redis.js', () => ({
    getRedis: vi.fn(() => ({
        setex: vi.fn(),
    })),
}));

vi.mock('./token.service.js', () => ({
    tokenService: {
        generateAccessToken: vi.fn(() => ({
            token: 'access-token-123',
            expiresAt: new Date(Date.now() + 900000),
        })),
        generateRefreshToken: vi.fn(() => ({
            token: 'refresh-token-123',
            expiresAt: new Date(Date.now() + 604800000),
            jti: 'jti-123',
        })),
        generateAuthorizationCode: vi.fn(() => 'auth-code-123'),
        storeToken: vi.fn(),
        verifyToken: vi.fn(() => ({
            sub: 'user-123',
            type: 'user',
            jti: 'jti-123',
        })),
        revokeToken: vi.fn(),
    },
}));

vi.mock('@sada/shared', () => ({
    InvalidClientError: class extends Error {
        constructor(msg: string) {
            super(msg);
            this.name = 'InvalidClientError';
        }
    },
    InvalidGrantError: class extends Error {
        constructor(msg: string) {
            super(msg);
            this.name = 'InvalidGrantError';
        }
    },
    InvalidScopeError: class extends Error {
        constructor(msg: string) {
            super(msg);
            this.name = 'InvalidScopeError';
        }
    },
    NotFoundError: class extends Error {
        constructor(msg: string) {
            super(msg);
            this.name = 'NotFoundError';
        }
    },
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    })),
}));

describe('oauthService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('generateAuthorizationCode', () => {
        it('should generate an authorization code for valid request', async () => {
            const { oauthService } = await import('../services/oauth.service.js');

            const result = await oauthService.generateAuthorizationCode({
                clientId: 'client-123',
                userId: 'user-123',
                redirectUri: 'https://app.test/callback',
                scopes: ['openid', 'profile'],
            });

            expect(result).toBeDefined();
            expect(result.code).toBeDefined();
        });

        it('should support PKCE code challenge', async () => {
            const { oauthService } = await import('../services/oauth.service.js');

            const result = await oauthService.generateAuthorizationCode({
                clientId: 'client-123',
                userId: 'user-123',
                redirectUri: 'https://app.test/callback',
                scopes: ['openid'],
                codeChallenge: 'challenge-123',
                codeChallengeMethod: 'S256',
            });

            expect(result).toBeDefined();
        });
    });

    describe('verifyPKCE', () => {
        it('should verify plain PKCE verifier', async () => {
            const { oauthService } = await import('../services/oauth.service.js');

            const result = oauthService.verifyPKCE('verifier', 'verifier', 'plain');

            expect(result).toBe(true);
        });

        it('should reject mismatched plain PKCE', async () => {
            const { oauthService } = await import('../services/oauth.service.js');

            const result = oauthService.verifyPKCE('verifier1', 'verifier2', 'plain');

            expect(result).toBe(false);
        });
    });
});
