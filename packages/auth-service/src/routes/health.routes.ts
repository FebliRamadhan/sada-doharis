import { Router } from 'express';
import { checkAllDatabasesHealth } from '../config/database.js';
import { checkRedisHealth } from '../config/redis.js';

const router = Router();

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Liveness probe
 *     description: Returns service liveness (does not check dependencies)
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is alive
 */
router.get('/', (_req, res) => {
    res.json({
        status: 'healthy',
        service: 'auth-service',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    });
});

/**
 * @swagger
 * /health/ready:
 *   get:
 *     summary: Readiness probe
 *     description: Pings PostgreSQL and Redis; returns 503 if any dependency is down
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: All dependencies reachable
 *       503:
 *         description: One or more dependencies are unreachable
 */
router.get('/ready', async (_req, res) => {
    const [databases, redis] = await Promise.all([
        checkAllDatabasesHealth(),
        checkRedisHealth(),
    ]);

    const dbOk = databases.every((d) => d.connected);
    const ready = dbOk && redis.connected;

    res.status(ready ? 200 : 503).json({
        status: ready ? 'ready' : 'unavailable',
        checks: {
            databases,
            redis,
        },
    });
});

export { router as healthRoutes };
