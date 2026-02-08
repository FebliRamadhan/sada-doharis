import { Router } from 'express';
import { createProxyMiddleware, type Options } from 'http-proxy-middleware';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

const AUTH_SERVICE_URL = process.env['AUTH_SERVICE_URL'] ?? 'http://localhost:3001';

// Create proxy options
const createProxy = (target: string, pathRewrite?: Record<string, string>): Options => ({
    target,
    changeOrigin: true,
    pathRewrite,
    on: {
        proxyReq: (proxyReq, req) => {
            // Forward request ID
            const requestId = (req as any).res?.locals?.['requestId'];
            if (requestId) {
                proxyReq.setHeader('X-Request-ID', requestId);
            }

            // Forward user info from JWT
            const user = (req as any).user;
            if (user) {
                proxyReq.setHeader('X-User-ID', user.sub);
                proxyReq.setHeader('X-User-Type', user.type);
                proxyReq.setHeader('X-User-Scopes', user.scopes?.join(',') ?? '');
            }
        },
    },
});

// OAuth endpoints (public)
router.use('/oauth', createProxyMiddleware(createProxy(AUTH_SERVICE_URL, {
    '^/api/oauth': '/oauth',
})));

// User management (authenticated)
router.use('/users', authMiddleware, createProxyMiddleware(createProxy(AUTH_SERVICE_URL, {
    '^/api/users': '/users',
})));

// Client management (authenticated)
router.use('/clients', authMiddleware, createProxyMiddleware(createProxy(AUTH_SERVICE_URL, {
    '^/api/clients': '/clients',
})));

// Add more service proxies here as needed
// Example:
// router.use('/products', authMiddleware, createProxyMiddleware(createProxy(PRODUCT_SERVICE_URL)));
// router.use('/orders', authMiddleware, createProxyMiddleware(createProxy(ORDER_SERVICE_URL)));

export { router as proxyRoutes };
