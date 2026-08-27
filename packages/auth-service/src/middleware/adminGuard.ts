import type { Request, Response, NextFunction } from 'express';
import { tokenService } from '../services/token.service.js';
import { prisma } from '../config/database.js';
import { sendError, ErrorCodes } from '@sada/shared';

const ADMIN_EMAILS = (process.env['ADMIN_EMAILS'] ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/**
 * Menjaga rute admin.
 *
 * Seluruh badannya dibungkus try/catch dan itu bukan kehati-hatian berlebihan.
 * Express 4 tidak menunggu promise dari middleware, jadi lemparan apa pun di
 * fungsi `async` ini menjadi unhandled rejection — dan Node 22 mematikan proses
 * karenanya. `verifyToken` melempar untuk setiap token yang kedaluwarsa atau
 * cacat, dan di produksi nginx mem-proxy /api/ langsung ke service ini tanpa
 * melewati gateway, sehingga satu permintaan mana pun dari internet dengan
 * header Bearer sembarang cukup untuk menjatuhkan SSO bagi semua pengguna.
 *
 * Token yang tidak sah adalah jawaban 401, bukan alasan mematikan server.
 */
export async function adminGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers['authorization'];
    const userId = req.headers['x-user-id'] as string | undefined;

    let resolvedUserId: string | undefined = userId;

    if (!resolvedUserId && authHeader?.startsWith('Bearer ')) {
      try {
        const payload = tokenService.verifyToken(authHeader.slice(7));
        if (payload?.sub && payload.type === 'user') {
          resolvedUserId = payload.sub;
        }
      } catch {
        // Kedaluwarsa, tanda tangan salah, atau bukan JWT sama sekali —
        // semuanya berarti hal yang sama bagi pemanggil: belum terautentikasi.
        sendError(res, ErrorCodes.UNAUTHORIZED, 'Authentication required', 401);
        return;
      }
    }

    if (!resolvedUserId) {
      sendError(res, ErrorCodes.UNAUTHORIZED, 'Authentication required', 401);
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: resolvedUserId },
      select: { email: true },
    });

    if (!user || !ADMIN_EMAILS.includes(user.email.toLowerCase())) {
      sendError(res, ErrorCodes.FORBIDDEN, 'Admin access required', 403);
      return;
    }

    next();
  } catch (error) {
    // Termasuk kegagalan database: diserahkan ke error handler, bukan dibiarkan
    // menjadi rejection yang tak tertangani.
    next(error);
  }
}

export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
