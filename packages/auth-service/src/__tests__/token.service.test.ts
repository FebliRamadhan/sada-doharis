import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock jsonwebtoken
vi.mock('jsonwebtoken', () => ({
    default: {
        sign: vi.fn((payload) => `mock-token-${payload.sub}`),
        verify: vi.fn((token) => {
            if (token.startsWith('mock-token-')) {
                return { sub: token.replace('mock-token-', ''), type: 'user', scopes: [] };
            }
            throw new Error('Invalid token');
        }),
    },
}));

// Mock crypto
vi.mock('crypto', () => ({
    default: {
        randomBytes: vi.fn(() => ({
            toString: () => 'mock-random-hex-string',
        })),
        randomUUID: vi.fn(() => 'mock-uuid'),
    },
}));

// Mock RSA keys so tests don't need to generate a real key pair
vi.mock('../config/keys.js', () => ({
    getPrivateKey: vi.fn(() => 'mock-private-key'),
    getPublicKey: vi.fn(() => 'mock-public-key'),
    getKeyId: vi.fn(() => 'test-kid'),
    getJWKS: vi.fn(() => ({ keys: [] })),
}));

// Mock database
vi.mock('../config/database.js', () => ({
    prisma: {
        oAuthToken: {
            create: vi.fn(),
            deleteMany: vi.fn(() => ({ count: 1 })),
        },
    },
}));

describe('tokenService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Set env vars
        vi.stubEnv('JWT_SECRET', 'test-secret');
        vi.stubEnv('JWT_ACCESS_TOKEN_EXPIRES_IN', '15m');
        vi.stubEnv('JWT_REFRESH_TOKEN_EXPIRES_IN', '7d');
    });

    describe('generateAccessToken', () => {
        it('should generate an access token with correct payload', async () => {
            const { tokenService } = await import('../services/token.service.js');

            const result = tokenService.generateAccessToken('user-123', 'user', ['read', 'write']);

            expect(result.token).toBeDefined();
            expect(result.token).toContain('mock-token');
            expect(result.expiresAt).toBeInstanceOf(Date);
            expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
        });

        it('should set correct expiration for client tokens', async () => {
            const { tokenService } = await import('../services/token.service.js');

            const result = tokenService.generateAccessToken('client-123', 'client', ['read']);

            expect(result.token).toBeDefined();
            expect(result.expiresAt).toBeInstanceOf(Date);
        });
    });

    describe('generateRefreshToken', () => {
        it('should generate a refresh token with jti', async () => {
            const { tokenService } = await import('../services/token.service.js');

            const result = tokenService.generateRefreshToken('user-123', 'user');

            expect(result.token).toBeDefined();
            expect(result.jti).toBe('mock-uuid');
            expect(result.expiresAt).toBeInstanceOf(Date);
        });
    });

    describe('verifyToken', () => {
        it('should verify and decode a valid token', async () => {
            const { tokenService } = await import('../services/token.service.js');

            const decoded = tokenService.verifyToken('mock-token-user-123');

            expect(decoded.sub).toBe('user-123');
        });

        it('should throw for invalid token', async () => {
            const { tokenService } = await import('../services/token.service.js');

            expect(() => tokenService.verifyToken('invalid-token')).toThrow();
        });
    });

    describe('generateAuthorizationCode', () => {
        it('should generate a random authorization code', async () => {
            const { tokenService } = await import('../services/token.service.js');

            const code = tokenService.generateAuthorizationCode();

            expect(code).toBe('mock-random-hex-string');
        });
    });

    describe('generateClientCredentials', () => {
        it('should generate client id and secret', async () => {
            const { tokenService } = await import('../services/token.service.js');

            const creds = tokenService.generateClientCredentials();

            expect(creds.clientId).toBe('mock-random-hex-string');
            expect(creds.clientSecret).toBe('mock-random-hex-string');
        });
    });
});
