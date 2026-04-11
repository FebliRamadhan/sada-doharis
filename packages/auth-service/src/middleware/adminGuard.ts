import type { Request, Response, NextFunction } from 'express';
import { tokenService } from '../services/token.service.js';
import { prisma } from '../config/database.js';
import { sendError, ErrorCodes } from '@sada/shared';

const ADMIN_EMAILS = (process.env['ADMIN_EMAILS'] ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export async function adminGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers['authorization'];
    const userId = req.headers['x-user-id'] as string | undefined;

    let resolvedUserId: string | undefined = userId;

    if (!resolvedUserId && authHeader?.startsWith('Bearer ')) {
        const payload = tokenService.verifyToken(authHeader.slice(7));
        if (payload?.sub && payload.type === 'user') {
            resolvedUserId = payload.sub;
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
}

export function isAdminEmail(email: string): boolean {
    return ADMIN_EMAILS.includes(email.toLowerCase());
}
