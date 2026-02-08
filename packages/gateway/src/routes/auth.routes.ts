import { Router } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const router = Router();

const AUTH_SERVICE_URL = process.env['AUTH_SERVICE_URL'] ?? 'http://localhost:3001';

// Proxy auth-related requests to auth service
const authProxy = createProxyMiddleware({
    target: AUTH_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: {
        '^/auth': '/auth', // Keep path as-is
    },
    on: {
        proxyReq: (proxyReq, req) => {
            // Forward request ID
            const requestId = (req as any).res?.locals?.['requestId'];
            if (requestId) {
                proxyReq.setHeader('X-Request-ID', requestId);
            }
        },
    },
});

// All /auth/* routes proxy to auth service
router.use('/', authProxy);

export { router as authRoutes };
