import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';

/**
 * API Endpoint Integration Tests
 *
 * These tests require a running test database and auth-service.
 * Run with: pnpm run test:integration
 *
 * The client-management routes are protected by adminGuard. The auth-service
 * strips the `x-user-id` header from inbound requests (only the gateway may set
 * it), so we authenticate the real way: seed an EXTERNAL admin user (whose email
 * is in ADMIN_EMAILS) with a password directly into the Docker Postgres (which is
 * not exposed on a host port) via `docker exec`, log in via POST /auth/login to
 * obtain a user access token, and send it as a Bearer token on protected routes.
 *
 * CSRF is skipped because we send no cookie; MFA is skipped because the user is
 * EXTERNAL (MFA_REQUIRED_INTERNAL only gates INTERNAL users).
 *
 * IMPORTANT: the admin email must NOT be on INTERNAL_EMAIL_DOMAIN, otherwise
 * loginWithPassword routes to LDAP (when LDAP is configured) and fails. Start the
 * auth-service with this email in ADMIN_EMAILS, a 32+ char JWT_SECRET, and a
 * non-empty SESSION_COOKIE_SECRET (login writes a signed session cookie):
 *   ADMIN_EMAILS="admin@menpan.go.id,integration-admin@sada.test" \
 *   JWT_SECRET="<32+ chars>" SESSION_COOKIE_SECRET="<any non-empty>" pnpm docker:dev
 */

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:3001';

// Non-internal email so login takes the password path (not LDAP). Must be present
// in the auth-service's ADMIN_EMAILS for adminGuard to grant admin access.
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'integration-admin@sada.test';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'IntegrationTest!123';
// bcryptjs hash of the default ADMIN_PASSWORD above. Precomputed so the test has
// no native-module dependency (the service uses bcryptjs; the hash is portable).
// Regenerate if ADMIN_PASSWORD changes: node -e "console.log(require('bcryptjs').hashSync('<pw>',10))"
const ADMIN_PASSWORD_HASH =
  process.env.TEST_ADMIN_PASSWORD_HASH ||
  '$2a$10$33H6JnylRh3XCPukPypd8.HXEpDZ0vYQbDQOKDSa/.9sjnZq6gXia';
const PG_CONTAINER = process.env.TEST_PG_CONTAINER || 'sada-postgres';
const PG_USER = process.env.TEST_PG_USER || 'postgres';
const PG_DB = process.env.TEST_PG_DB || 'sada_db';

interface TestContext {
  clientId?: string; // DB id — used for /clients/:id routes
  oauthClientId?: string; // public clientId — used for the OAuth token endpoint
  clientSecret?: string;
  accessToken?: string;
  authorizationCode?: string;
  adminToken?: string;
}

const ctx: TestContext = {};

/** Headers for admin-guarded routes (Bearer token of the seeded admin user). */
function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${ctx.adminToken ?? ''}`, ...extra };
}

const ADMIN_ID = 'integration-admin-user';

/** Seed (or reset) the admin user with a known password in the Docker Postgres. */
function seedAdminUser(): void {
  // Delete-then-insert (FK-safe) so the seed is idempotent across runs and never
  // hits a PK/email conflict with a leftover row from a previous run.
  const match = `WHERE "userId" IN (SELECT id FROM "User" WHERE email = '${ADMIN_EMAIL}' OR id = '${ADMIN_ID}')`;
  const sql =
    `BEGIN;` +
    `DELETE FROM "OAuthToken" ${match};` +
    `DELETE FROM "OAuthAuthorizationCode" ${match};` +
    `DELETE FROM "User" WHERE email = '${ADMIN_EMAIL}' OR id = '${ADMIN_ID}';` +
    `INSERT INTO "User" (id, email, name, password, "userType", "isActive", "updatedAt") ` +
    `VALUES ('${ADMIN_ID}', '${ADMIN_EMAIL}', 'Integration Admin', '${ADMIN_PASSWORD_HASH}', 'EXTERNAL', true, NOW());` +
    `COMMIT;`;
  // Feed SQL via stdin to avoid shell-quoting the double-quoted "User" identifier.
  // ON_ERROR_STOP=1 makes psql exit non-zero on SQL errors (otherwise it exits 0).
  const cmd = `docker exec -i ${PG_CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -qt -A -v ON_ERROR_STOP=1`;
  execSync(cmd, { encoding: 'utf8', input: sql });
}

/** Log in as the seeded admin and return a user access token. */
async function loginAsAdmin(): Promise<string> {
  const response = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const body = await response.json();
  if (!response.ok || !body?.data?.access_token) {
    throw new Error(`Admin login failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body.data.access_token as string;
}

describe('Auth Service API Integration Tests', () => {
  beforeAll(async () => {
    seedAdminUser();
    ctx.adminToken = await loginAsAdmin();
    expect(ctx.adminToken).toBeTruthy();
  });

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
        headers: adminHeaders({ 'Content-Type': 'application/json' }),
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
      expect(data.data.clientId).toBeDefined();
      expect(data.data.clientSecret).toBeDefined();
      expect(data.data.name).toBe('Integration Test Client');

      // Store for later tests
      ctx.clientId = data.data.id;
      ctx.oauthClientId = data.data.clientId;
      ctx.clientSecret = data.data.clientSecret;
    });

    it('GET /clients - should list all clients', async () => {
      const response = await fetch(`${BASE_URL}/clients`, { headers: adminHeaders() });

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
        headers: adminHeaders({ 'Content-Type': 'application/json' }),
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
        headers: adminHeaders(),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.data.clientSecret).toBeDefined();
      expect(data.data.clientSecret).not.toBe(ctx.clientSecret);

      // Update stored secret
      ctx.clientSecret = data.data.clientSecret;
    });
  });

  describe('OAuth Token Endpoints', () => {
    it('POST /oauth/token (client_credentials) - should issue access token', async () => {
      const response = await fetch(`${BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: ctx.oauthClientId,
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
        headers: adminHeaders(),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.data.deleted).toBe(true);
    });
  });
});
