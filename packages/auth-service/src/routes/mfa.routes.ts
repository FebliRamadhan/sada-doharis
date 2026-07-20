import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { sendSuccess, ValidationError, UnauthorizedError } from '@sada/shared';
import { mfaService } from '../services/mfa.service.js';
import { tokenService } from '../services/token.service.js';
import { sessionService } from '../services/session.service.js';
import { auditService } from '../services/audit.service.js';
import { adminGuard } from '../middleware/adminGuard.js';
import { csrfProtect } from '../middleware/csrf.js';
import {
  issueUserLogin,
  peekMfaTicket,
  deleteMfaTicket,
  bumpMfaAttempts,
  MFA_MAX_ATTEMPTS,
  MFA_PENDING_PREFIX,
  MFA_SETUP_PREFIX,
} from '../services/login-issuer.service.js';

const router = Router();

// ---- validation ----
const verifyLoginSchema = z.object({ ticket: z.string().min(1), code: z.string().min(1) });
const setupSchema = z.object({ ticket: z.string().min(1) });
const enableSchema = z.object({ ticket: z.string().min(1), code: z.string().min(1) });
const disableSchema = z.object({ code: z.string().min(1) });

/**
 * Resolve the authenticated user for self-service endpoints. Mirrors /auth/me:
 * gateway x-user-id → Bearer token → SSO session cookie.
 */
async function resolveUserId(req: Request): Promise<string | null> {
  const headerId = req.headers['x-user-id'] as string | undefined;
  if (headerId) return headerId;

  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = tokenService.verifyToken(authHeader.slice(7));
      if (payload?.sub) return payload.sub;
    } catch {
      // fall through to session
    }
  }
  return sessionService.getUserId(req);
}

/**
 * Verify a code (TOTP first, then a one-time backup code) for a user that already
 * has MFA enabled. Consumes the matched backup code. Returns true on success.
 */
async function verifyUserCode(
  user: { id: string; mfaSecret: string | null; mfaBackupCodes: string[] },
  code: string
): Promise<boolean> {
  if (!user.mfaSecret) return false;

  const secret = mfaService.decryptSecret(user.mfaSecret);
  if (mfaService.verifyTotp(secret, code)) return true;

  const idx = await mfaService.verifyBackupCode(user.mfaBackupCodes, code);
  if (idx >= 0) {
    const remaining = user.mfaBackupCodes.filter((_, i) => i !== idx);
    await prisma.user.update({ where: { id: user.id }, data: { mfaBackupCodes: remaining } });
    return true;
  }
  return false;
}

/**
 * @swagger
 * /auth/mfa/verify-login:
 *   post:
 *     summary: Complete login with an MFA code
 *     description: Exchanges a pending MFA ticket plus a TOTP/backup code for full tokens.
 *     tags: [Auth]
 */
router.post('/auth/mfa/verify-login', csrfProtect, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = verifyLoginSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid request', parsed.error.flatten().fieldErrors);
    const { ticket, code } = parsed.data;

    const data = await peekMfaTicket(MFA_PENDING_PREFIX, ticket);
    if (!data) throw new UnauthorizedError('MFA session expired. Please sign in again.');

    const user = await prisma.user.findUnique({ where: { id: data.userId } });
    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      await deleteMfaTicket(MFA_PENDING_PREFIX, ticket);
      throw new UnauthorizedError('MFA is not set up for this account.');
    }

    const ok = await verifyUserCode(user, code);
    if (!ok) {
      const attempts = await bumpMfaAttempts(MFA_PENDING_PREFIX, ticket);
      if (attempts >= MFA_MAX_ATTEMPTS) {
        await deleteMfaTicket(MFA_PENDING_PREFIX, ticket);
        throw new UnauthorizedError('Too many invalid codes. Please sign in again.');
      }
      throw new UnauthorizedError('Invalid verification code.');
    }

    await deleteMfaTicket(MFA_PENDING_PREFIX, ticket);
    void auditService.log({
      action: 'MFA_VERIFIED',
      userId: user.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    const payload = await issueUserLogin({ req, res, userId: user.id, scopes: data.scopes });
    sendSuccess(res, payload);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /auth/mfa/setup:
 *   post:
 *     summary: Begin MFA enrollment (forced for internal users)
 *     description: Validates the setup ticket and returns a TOTP secret + QR code.
 *     tags: [Auth]
 */
router.post('/auth/mfa/setup', csrfProtect, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = setupSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid request', parsed.error.flatten().fieldErrors);

    const data = await peekMfaTicket(MFA_SETUP_PREFIX, parsed.data.ticket);
    if (!data) throw new UnauthorizedError('MFA setup session expired. Please sign in again.');

    const user = await prisma.user.findUnique({ where: { id: data.userId } });
    if (!user) throw new UnauthorizedError('Account not found.');

    const { secret, uri } = mfaService.generateSecret(user.email);
    // Persist the (encrypted) pending secret; mfaEnabled stays false until confirmed.
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaSecret: mfaService.encryptSecret(secret) },
    });

    const qr = await mfaService.buildQrDataUrl(uri);
    sendSuccess(res, { secret, uri, qr });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /auth/mfa/enable:
 *   post:
 *     summary: Confirm MFA enrollment and finish login
 *     description: Verifies the first TOTP code, enables MFA, returns backup codes + full tokens.
 *     tags: [Auth]
 */
router.post('/auth/mfa/enable', csrfProtect, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = enableSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid request', parsed.error.flatten().fieldErrors);
    const { ticket, code } = parsed.data;

    const data = await peekMfaTicket(MFA_SETUP_PREFIX, ticket);
    if (!data) throw new UnauthorizedError('MFA setup session expired. Please sign in again.');

    const user = await prisma.user.findUnique({ where: { id: data.userId } });
    if (!user || !user.mfaSecret) throw new UnauthorizedError('Start MFA setup first.');

    const secret = mfaService.decryptSecret(user.mfaSecret);
    if (!mfaService.verifyTotp(secret, code)) {
      const attempts = await bumpMfaAttempts(MFA_SETUP_PREFIX, ticket);
      if (attempts >= MFA_MAX_ATTEMPTS) {
        await deleteMfaTicket(MFA_SETUP_PREFIX, ticket);
        throw new UnauthorizedError('Too many invalid codes. Please sign in again.');
      }
      throw new UnauthorizedError('Invalid verification code.');
    }

    const { plain, hashes } = await mfaService.generateBackupCodes();
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true, mfaEnabledAt: new Date(), mfaBackupCodes: hashes },
    });

    await deleteMfaTicket(MFA_SETUP_PREFIX, ticket);
    void auditService.log({
      action: 'MFA_ENABLED',
      userId: user.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    const payload = await issueUserLogin({ req, res, userId: user.id, scopes: data.scopes });
    sendSuccess(res, { ...payload, backup_codes: plain });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /auth/mfa/status:
 *   get:
 *     summary: Current user's MFA status
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 */
router.get('/auth/mfa/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = await resolveUserId(req);
    if (!userId) throw new UnauthorizedError('Not authenticated');
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true, mfaEnabledAt: true },
    });
    if (!user) throw new UnauthorizedError('Not authenticated');
    sendSuccess(res, { enabled: user.mfaEnabled, enabled_at: user.mfaEnabledAt });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /auth/mfa/disable:
 *   post:
 *     summary: Disable MFA for the current user (requires a valid code)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 */
router.post('/auth/mfa/disable', csrfProtect, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = disableSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid request', parsed.error.flatten().fieldErrors);

    const userId = await resolveUserId(req);
    if (!userId) throw new UnauthorizedError('Not authenticated');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaEnabled) throw new ValidationError('MFA is not enabled.');

    const ok = await verifyUserCode(user, parsed.data.code);
    if (!ok) throw new UnauthorizedError('Invalid verification code.');

    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [], mfaEnabledAt: null },
    });
    void auditService.log({
      action: 'MFA_DISABLED',
      userId: user.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    sendSuccess(res, { disabled: true });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /admin/mfa/users:
 *   get:
 *     summary: List internal users and their MFA status (admin)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 */
router.get('/admin/mfa/users', adminGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt((req.query['page'] as string) ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt((req.query['limit'] as string) ?? '20', 10) || 20));

    const where = { userType: 'INTERNAL' as const };
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: { id: true, email: true, name: true, mfaEnabled: true, mfaEnabledAt: true },
        orderBy: { email: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    sendSuccess(res, { users, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /admin/mfa/users/{id}/disable:
 *   post:
 *     summary: Reset/disable a user's MFA (admin — e.g. lost device)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 */
router.post('/admin/mfa/users/:id/disable', adminGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id'] as string;
    if (!id) throw new ValidationError('Missing user id');

    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw new ValidationError('User not found');

    await prisma.user.update({
      where: { id },
      data: { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [], mfaEnabledAt: null },
    });
    void auditService.log({
      action: 'MFA_ADMIN_RESET',
      userId: id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      details: { resetBy: (req.headers['x-user-id'] as string) ?? 'admin' },
    });
    sendSuccess(res, { reset: true });
  } catch (error) {
    next(error);
  }
});

export { router as mfaRoutes };
