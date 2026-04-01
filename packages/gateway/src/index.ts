import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createLogger } from '@sada/shared';

import { errorHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { authRoutes } from './routes/auth.routes.js';
import { proxyRoutes } from './routes/proxy.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { fetchJWKS } from './config/jwks.js';

const logger = createLogger('gateway');
const app = express();

const PORT = process.env['PORT'] ?? 3000;

// Security middlewares
app.use(helmet());
app.use(cors({
    origin: process.env['CORS_ORIGIN']?.split(',') ?? '*',
    credentials: true,
}));

// Request parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(compression());

// Logging & request ID
app.use(requestId);
app.use(morgan('combined', {
    stream: { write: (message) => logger.info(message.trim()) }
}));

// Global rate limiting
app.use(rateLimiter);

// Stricter rate limiter for authentication endpoints
const authRateLimiter = rateLimit({
    windowMs: parseInt(process.env['AUTH_RATE_LIMIT_WINDOW_MS'] ?? '60000', 10),
    max: parseInt(process.env['AUTH_RATE_LIMIT_MAX_REQUESTS'] ?? '5', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many authentication attempts, please try again later.',
        },
    },
    keyGenerator: (req) =>
        req.headers['x-forwarded-for'] as string ?? req.socket.remoteAddress ?? 'unknown',
});

app.use('/auth/login', authRateLimiter);
app.use('/auth/ldap/login', authRateLimiter);
app.use('/auth/register', authRateLimiter);

// Routes
app.use('/health', healthRoutes);
app.use('/auth', authRoutes);
app.use('/api', proxyRoutes);

// Error handling
app.use(errorHandler);

// Graceful shutdown
async function shutdown(): Promise<void> {
    logger.info('Shutting down gateway...');
    await disconnectRedis();
    process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
async function start(): Promise<void> {
    await connectRedis();
    // Pre-fetch JWKS for RS256 verification (retry if auth-service not ready yet)
    try {
        await fetchJWKS();
    } catch {
        logger.warn('JWKS pre-fetch failed — will retry on first request');
    }
    app.listen(PORT, () => {
        logger.info(`API Gateway running on port ${PORT}`);
        logger.info(`Health check: http://localhost:${PORT}/health`);
    });
}

start().catch((error) => {
    logger.error('Failed to start gateway', { error });
    process.exit(1);
});

export { app };
