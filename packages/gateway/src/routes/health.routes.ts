import { Router } from 'express';
import { getRedis } from '../config/redis.js';

const router = Router();

const AUTH_SERVICE_URL = process.env['AUTH_SERVICE_URL'] ?? 'http://localhost:3001';

router.get('/', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'api-gateway',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

router.get('/ready', async (_req, res) => {
  const checks: Record<string, { ok: boolean; error?: string; latencyMs?: number }> = {};

  // Redis
  const redisStart = Date.now();
  try {
    await getRedis().ping();
    checks['redis'] = { ok: true, latencyMs: Date.now() - redisStart };
  } catch (err) {
    checks['redis'] = { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }

  // Auth service reachability
  const authStart = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`${AUTH_SERVICE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    checks['auth_service'] = {
      ok: response.ok,
      latencyMs: Date.now() - authStart,
    };
  } catch (err) {
    checks['auth_service'] = { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }

  const ready = Object.values(checks).every((c) => c.ok);
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'unavailable',
    checks,
  });
});

export { router as healthRoutes };
