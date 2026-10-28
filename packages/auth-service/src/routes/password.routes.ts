import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { User } from '@prisma/client';
import { prisma } from '../config/database.js';
import { getRedis } from '../config/redis.js';
import {
  sendSuccess,
  AppError,
  ErrorCodes,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from '@sada/shared';
import { tokenService } from '../services/token.service.js';
import { sessionService } from '../services/session.service.js';
import { auditService } from '../services/audit.service.js';
import { zimbraService } from '../services/zimbra.service.js';
import { checkNewPassword } from '../services/password-policy.service.js';
import { csrfProtect } from '../middleware/csrf.js';
import {
  issueUserLogin,
  peekMfaTicket,
  deleteMfaTicket,
  revokeAllUserAccess,
  PWD_CHANGE_PREFIX,
} from '../services/login-issuer.service.js';

/**
 * Ganti Password LDAP (CONTEXT.md — Masa Berlaku Password; docs/adr/0002).
 *
 *  - /auth/password/change-expired : langkah wajib di tengah login, memakai
 *    tiket dari gerbang setelah MFA.
 *  - /auth/password/change         : ganti sukarela kapan saja oleh user yang
 *    sudah login.
 *
 * Keduanya berakhir sama: password diganti lewat Zimbra dengan password lama
 * user sendiri, semua sesi lain dicabut, lalu login dilanjutkan dengan token
 * dan sesi baru.
 */
const router = Router();

const changeSchema = z.object({
  old_password: z.string().min(1),
  new_password: z.string().min(1).max(128),
});
const changeExpiredSchema = changeSchema.extend({ ticket: z.string().min(1) });

const MAX_WRONG_OLD_PASSWORD = 5;
const WRONG_OLD_PASSWORD_WINDOW_S = 15 * 60;
const attemptsKey = (userId: string) => `${PWD_CHANGE_PREFIX}att:user:${userId}`;

/** Bearer → sesi SSO. x-user-id sudah dibuang di index.ts untuk request langsung. */
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

async function changePasswordAndLogin(opts: {
  req: Request;
  res: Response;
  user: User;
  oldPassword: string;
  newPassword: string;
  scopes: string[];
  reason: 'expired' | 'voluntary';
}): Promise<void> {
  const { req, res, user, oldPassword, newPassword, scopes, reason } = opts;

  if (user.userType !== 'INTERNAL' || !user.isActive) {
    throw new ForbiddenError('Ganti password hanya tersedia untuk akun internal yang aktif.');
  }

  // Zimbra punya kebijakan lockout sendiri; ini menjaga SADA tidak menjadi
  // jalur menebak password lama yang lebih longgar dari form login.
  const redis = getRedis();
  const wrong = parseInt((await redis.get(attemptsKey(user.id))) ?? '0', 10);
  if (wrong >= MAX_WRONG_OLD_PASSWORD) {
    throw new AppError(
      ErrorCodes.FORBIDDEN,
      'Terlalu banyak percobaan password lama yang salah. Coba lagi 15 menit lagi.',
      429
    );
  }

  const problems = checkNewPassword(newPassword, {
    oldPassword,
    email: user.email,
    name: user.name,
  });
  if (problems.length > 0) {
    throw new ValidationError('Password baru belum memenuhi syarat.', { new_password: problems });
  }

  try {
    await zimbraService.changePassword(user.email, oldPassword, newPassword);
  } catch (error) {
    if (error instanceof ValidationError && error.details?.['old_password']) {
      const count = await redis.incr(attemptsKey(user.id));
      if (count === 1) await redis.expire(attemptsKey(user.id), WRONG_OLD_PASSWORD_WINDOW_S);
    }
    void auditService.log({
      action: 'PASSWORD_CHANGE_FAILED',
      userId: user.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      details: { reason, message: (error as Error).message },
    });
    throw error;
  }

  await redis.del(attemptsKey(user.id));
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordChangedAt: new Date(), passwordMustChange: false },
  });
  await revokeAllUserAccess(user.id);

  void auditService.log({
    action: 'PASSWORD_CHANGED',
    userId: user.id,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    details: { reason },
  });

  const payload = await issueUserLogin({ req, res, userId: user.id, scopes });
  sendSuccess(res, payload);
}

/**
 * @swagger
 * /auth/password/change-expired:
 *   post:
 *     summary: Ganti password yang kedaluwarsa untuk menyelesaikan login
 *     description: Menukar tiket `password_ticket` + password lama + password baru dengan token penuh.
 *     tags: [Auth]
 */
router.post(
  '/auth/password/change-expired',
  csrfProtect,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = changeExpiredSchema.safeParse(req.body);
      if (!parsed.success)
        throw new ValidationError('Invalid request', parsed.error.flatten().fieldErrors);
      const { ticket, old_password, new_password } = parsed.data;

      const data = await peekMfaTicket(PWD_CHANGE_PREFIX, ticket);
      if (!data) throw new UnauthorizedError('Sesi ganti password berakhir. Silakan login ulang.');

      const user = await prisma.user.findUnique({ where: { id: data.userId } });
      if (!user) {
        await deleteMfaTicket(PWD_CHANGE_PREFIX, ticket);
        throw new UnauthorizedError('Sesi ganti password berakhir. Silakan login ulang.');
      }

      await changePasswordAndLogin({
        req,
        res,
        user,
        oldPassword: old_password,
        newPassword: new_password,
        scopes: data.scopes,
        reason: 'expired',
      });
      await deleteMfaTicket(PWD_CHANGE_PREFIX, ticket);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /auth/password/change:
 *   post:
 *     summary: Ganti password LDAP (sukarela)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/auth/password/change',
  csrfProtect,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = await resolveUserId(req);
      if (!userId) throw new UnauthorizedError('Not authenticated');

      const parsed = changeSchema.safeParse(req.body);
      if (!parsed.success)
        throw new ValidationError('Invalid request', parsed.error.flatten().fieldErrors);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new UnauthorizedError('Not authenticated');

      await changePasswordAndLogin({
        req,
        res,
        user,
        oldPassword: parsed.data.old_password,
        newPassword: parsed.data.new_password,
        scopes: ['profile', 'email'],
        reason: 'voluntary',
      });
    } catch (error) {
      next(error);
    }
  }
);

export { router as passwordRoutes };
