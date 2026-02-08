/**
 * Integration test setup
 * Sets up test environment and helpers for integration tests
 */
import { beforeAll, afterAll, beforeEach } from 'vitest';

// Set test environment
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.JWT_ACCESS_TOKEN_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_TOKEN_EXPIRES_IN = '7d';

// Database URL for test DB
process.env.AUTH_DATABASE_URL =
    process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/sada_auth_test';

let testDbInitialized = false;

beforeAll(async () => {
    if (!testDbInitialized) {
        console.info('Setting up integration test database...');
        testDbInitialized = true;
    }
});

afterAll(async () => {
    console.info('Cleaning up integration test resources...');
});

beforeEach(async () => {
    // Reset state before each test if needed
});

export const testHelpers = {
    createTestClient: async () => ({
        id: 'test-client-id',
        name: 'Test Client',
        secret: 'test-client-secret',
        redirectUris: ['http://localhost:3000/callback'],
        scopes: ['openid', 'profile', 'email'],
        grants: ['authorization_code', 'client_credentials', 'refresh_token'],
    }),

    createTestUser: async () => ({
        id: 'test-user-id',
        email: 'test@example.com',
        name: 'Test User',
    }),
};
