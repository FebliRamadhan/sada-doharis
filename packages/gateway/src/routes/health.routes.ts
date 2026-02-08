import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
    res.json({
        status: 'healthy',
        service: 'api-gateway',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    });
});

router.get('/ready', (_req, res) => {
    // Add dependency checks here (db, redis, etc.)
    res.json({
        status: 'ready',
        checks: {
            gateway: true,
        },
    });
});

export { router as healthRoutes };
