import crypto from 'crypto';
import type { Request, Response } from 'express';
import { sendSuccess } from '@sada/shared';
import { prisma } from '../config/database.js';
import { getRedis } from '../config/redis.js';
import { tokenService } from './token.service.js';
import { sessionService } from './session.service.js';
import { auditService, AUDIT_ACTIONS } from './audit.service.js';
import { userService } from './user.service.js';
import { isAdminEmail } from '../middleware/adminGuard.js';

const MFA_PENDING_TTL = parseInt(process.env['MFA_PENDING_TTL'] ?? '300', 10);

export const MFA_PENDING_PREFIX = 'mfa_pending:';
export const MFA_SETUP_PREFIX = 'mfa_setup:';

export interface MfaTicketData {
  userId: string;
  scopes: string[];
}

// Lazy-cached system client id (mirrors auth.routes). The MFA flow re-issues
// tokens, so it needs the same internal client the password/LDAP login uses.
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

/**
 * Issue a full user login: generate + persist access/refresh tokens, write the
 * SSO session cookie, audit the login, and return the standard login payload.
 * Shared by /auth/login, /auth/ldap/login (non-MFA path), /auth/mfa/verify-login,
 * and /auth/mfa/enable so the token-issuing tail lives in exactly one place.
 */
export async function issueUserLogin(opts: {
  req: Request;
  res: Response;
  userId: string;
  scopes: string[];
}): Promise<Record<string, unknown>> {
  const { req, res, userId, scopes } = opts;

  const accessToken = tokenService.generateAccessToken(userId, 'user', scopes);
  const refreshToken = tokenService.generateRefreshToken(userId, 'user');

  await tokenService.storeToken({
    accessToken: accessToken.token,
    refreshToken: refreshToken.token,
    accessTokenExpiresAt: accessToken.expiresAt,
    refreshTokenExpiresAt: refreshToken.expiresAt,
    scopes,
    userId,
    clientId: await getSystemClientId(),
  });

  void auditService.log({
    action: AUDIT_ACTIONS.LOGIN,
    userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  await sessionService.create(res, userId);

  const user = await userService.findById(userId);

  return {
    user: { ...user, isAdmin: isAdminEmail(user.email) },
    access_token: accessToken.token,
    token_type: 'Bearer',
    expires_in: Math.floor((accessToken.expiresAt.getTime() - Date.now()) / 1000),
    refresh_token: refreshToken.token,
  };
}

/**
 * Enforce MFA for INTERNAL users. When MFA applies, this writes the appropriate
 * pending ticket to Redis, sends the `mfa_required` / `mfa_setup_required`
 * response, and returns true (caller must stop — token must NOT be issued).
 * Returns false when MFA does not apply (caller proceeds with normal login).
 */
export async function maybeRequireMfa(
  res: Response,
  user: { id: string; userType: string; mfaEnabled?: boolean },
  scopes: string[]
): Promise<boolean> {
  // Kill-switch for emergencies; default ON.
  const required = process.env['MFA_REQUIRED_INTERNAL'] !== 'false';
  if (!required || user.userType !== 'INTERNAL') return false;

  const ticket = crypto.randomBytes(32).toString('hex');
  const data: MfaTicketData = { userId: user.id, scopes };
  const redis = getRedis();

  if (user.mfaEnabled) {
    await redis.setex(`${MFA_PENDING_PREFIX}${ticket}`, MFA_PENDING_TTL, JSON.stringify(data));
    sendSuccess(res, { mfa_required: true, mfa_ticket: ticket });
  } else {
    await redis.setex(`${MFA_SETUP_PREFIX}${ticket}`, MFA_PENDING_TTL, JSON.stringify(data));
    sendSuccess(res, { mfa_setup_required: true, mfa_ticket: ticket });
  }
  return true;
}

type MfaPrefix = typeof MFA_PENDING_PREFIX | typeof MFA_SETUP_PREFIX;

/**
 * Read a pending MFA ticket WITHOUT consuming it. Returns null when missing/expired.
 * Used while the code is still being verified (a wrong code must not burn the ticket).
 */
export async function peekMfaTicket(
  prefix: MfaPrefix,
  ticket: string
): Promise<MfaTicketData | null> {
  const raw = await getRedis().get(`${prefix}${ticket}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MfaTicketData;
  } catch {
    return null;
  }
}

/**
 * Delete a ticket (and its attempt counter) once the flow has succeeded or aborted.
 */
export async function deleteMfaTicket(prefix: MfaPrefix, ticket: string): Promise<void> {
  await getRedis().del(`${prefix}${ticket}`, `${prefix}att:${ticket}`);
}

/**
 * Track failed code attempts per ticket. Returns the running count; caller aborts
 * once it exceeds the cap to stop brute-forcing the 6-digit code.
 */
export async function bumpMfaAttempts(prefix: MfaPrefix, ticket: string): Promise<number> {
  const redis = getRedis();
  const key = `${prefix}att:${ticket}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 300);
  return count;
}

export const MFA_MAX_ATTEMPTS = 5;
