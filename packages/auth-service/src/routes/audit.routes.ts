import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { sendPaginated } from '@sada/shared';
import { prisma } from '../config/database.js';
import { adminGuard } from '../middleware/adminGuard.js';

const router = Router();

router.use(adminGuard);

/**
 * GET /audit-logs — Paginated audit log with optional filters
 * Query: page, limit, action, clientId, userId
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const page = parseInt(req.query['page'] as string) || 1;
        const limit = Math.min(parseInt(req.query['limit'] as string) || 20, 100);
        const skip = (page - 1) * limit;

        const action = req.query['action'] as string | undefined;
        const clientId = req.query['clientId'] as string | undefined;
        const userId = req.query['userId'] as string | undefined;

        const where = {
            ...(action ? { action } : {}),
            ...(clientId ? { clientId } : {}),
            ...(userId ? { userId } : {}),
        };

        const [logs, total] = await Promise.all([
            prisma.auditLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            prisma.auditLog.count({ where }),
        ]);

        sendPaginated(res, logs, page, limit, total);
    } catch (error) {
        next(error);
    }
});

export { router as auditRoutes };
