import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * API Endpoint Integration Tests
 *
 * These tests require a running test database and auth-service.
 * Run with: pnpm run test:integration
 */

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:3001';

interface TestContext {
    clientId?: string;
    clientSecret?: string;
    accessToken?: string;
    authorizationCode?: string;
}

const ctx: TestContext = {};

describe('Auth Service API Integration Tests', () => {
    describe('Health Check', () => {
        it('GET /health - should return healthy status', async () => {
            const response = await fetch(`${BASE_URL}/health`);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.status).toBe('healthy');
        });
    });

    describe('OAuth Client Management', () => {
        it('POST /clients - should create a new OAuth client', async () => {
            const response = await fetch(`${BASE_URL}/clients`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'Integration Test Client',
                    redirectUris: ['http://localhost:3000/callback'],
                    grants: ['authorization_code', 'client_credentials', 'refresh_token'],
                    scopes: ['openid', 'profile', 'email'],
                }),
            });

            expect(response.status).toBe(201);

            const data = await response.json();
            expect(data.data.id).toBeDefined();
            expect(data.data.secret).toBeDefined();
            expect(data.data.name).toBe('Integration Test Client');

            // Store for later tests
            ctx.clientId = data.data.id;
            ctx.clientSecret = data.data.secret;
        });

        it('GET /clients - should list all clients', async () => {
            const response = await fetch(`${BASE_URL}/clients`);

            expect(response.status).toBe(200);

            const data = await response.json();
            expect(data.data).toBeInstanceOf(Array);
            expect(data.meta).toBeDefined();
            expect(data.meta.total).toBeGreaterThan(0);
        });

        it('GET /clients/:id - should get client by ID', async () => {
            const response = await fetch(`${BASE_URL}/clients/${ctx.clientId}`);

            expect(response.status).toBe(200);

            const data = await response.json();
            expect(data.data.id).toBe(ctx.clientId);
            expect(data.data.name).toBe('Integration Test Client');
        });

        it('PATCH /clients/:id - should update client', async () => {
            const response = await fetch(`${BASE_URL}/clients/${ctx.clientId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'Updated Integration Test Client',
                }),
            });

            expect(response.status).toBe(200);

            const data = await response.json();
            expect(data.data.name).toBe('Updated Integration Test Client');
        });

        it('POST /clients/:id/regenerate-secret - should regenerate secret', async () => {
            const response = await fetch(`${BASE_URL}/clients/${ctx.clientId}/regenerate-secret`, {
                method: 'POST',
            });

            expect(response.status).toBe(200);

            const data = await response.json();
            expect(data.data.secret).toBeDefined();
            expect(data.data.secret).not.toBe(ctx.clientSecret);

            // Update stored secret
            ctx.clientSecret = data.data.secret;
        });
    });

    describe('OAuth Token Endpoints', () => {
        it('POST /oauth/token (client_credentials) - should issue access token', async () => {
            const response = await fetch(`${BASE_URL}/oauth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grant_type: 'client_credentials',
                    client_id: ctx.clientId,
                    client_secret: ctx.clientSecret,
                    scope: 'openid profile',
                }),
            });

            expect(response.status).toBe(200);

            const data = await response.json();
            expect(data.access_token).toBeDefined();
            expect(data.token_type).toBe('Bearer');
            expect(data.expires_in).toBeGreaterThan(0);

            ctx.accessToken = data.access_token;
        });

        it('POST /oauth/revoke - should revoke token', async () => {
            const response = await fetch(`${BASE_URL}/oauth/revoke`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: ctx.accessToken,
                }),
            });

            expect(response.status).toBe(200);

            const data = await response.json();
            expect(data.data.revoked).toBe(true);
        });
    });

    describe('OpenID Connect Discovery', () => {
        it('GET /oauth/.well-known/openid-configuration - should return OIDC config', async () => {
            const response = await fetch(`${BASE_URL}/oauth/.well-known/openid-configuration`);

            expect(response.status).toBe(200);

            const data = await response.json();
            expect(data.issuer).toBeDefined();
            expect(data.authorization_endpoint).toBeDefined();
            expect(data.token_endpoint).toBeDefined();
            expect(data.grant_types_supported).toContain('authorization_code');
            expect(data.response_types_supported).toContain('code');
        });
    });

    describe('Cleanup', () => {
        it('DELETE /clients/:id - should delete the test client', async () => {
            const response = await fetch(`${BASE_URL}/clients/${ctx.clientId}`, {
                method: 'DELETE',
            });

            expect(response.status).toBe(200);

            const data = await response.json();
            expect(data.data.deleted).toBe(true);
        });
    });
});
