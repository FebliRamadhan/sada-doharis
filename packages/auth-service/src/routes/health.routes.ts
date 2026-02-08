import { Router } from 'express';

const router = Router();

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check
 *     description: Returns service health status and uptime
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "healthy"
 *                 service:
 *                   type: string
 *                   example: "auth-service"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 *                   description: Uptime in seconds
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
 *     summary: Readiness check
 *     description: Returns readiness status with dependency checks
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is ready
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ready"
 *                 checks:
 *                   type: object
 *                   properties:
 *                     database:
 *                       type: boolean
 */
router.get('/ready', (_req, res) => {
    res.json({
        status: 'ready',
        checks: {
            database: true, // TODO: Add actual DB check
        },
    });
});

export { router as healthRoutes };
