import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { createLogger } from '@sada/shared';

import { errorHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { oauthRoutes } from './routes/oauth.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { clientRoutes } from './routes/client.routes.js';
import { userRoutes } from './routes/user.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { oidcRoutes } from './routes/oidc.routes.js';
import { initPassport } from './config/passport.js';
import { setupSwagger } from './swagger.js';
import { prisma } from './config/database.js';
import { disconnectAllDatabases } from './config/database.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { tokenService } from './services/token.service.js';

const logger = createLogger('auth-service');
const app = express();

const PORT = process.env['AUTH_SERVICE_PORT'] ?? 3001;

// Security middlewares
app.use(helmet());
app.use(cors({
    origin: process.env['CORS_ORIGIN']?.split(',') ?? '*',
    credentials: true,
}));

// Strip internal identity headers — only the gateway is allowed to set these
app.use((_req, _res, next) => {
    delete _req.headers['x-user-id'];
    delete _req.headers['x-user-type'];
    delete _req.headers['x-user-scopes'];
    next();
});

// Request parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Initialize Passport
initPassport(app);

// Logging & request ID
app.use(requestId);
app.use(morgan('combined', {
    stream: { write: (message) => logger.info(message.trim()) }
}));

// Swagger API docs
setupSwagger(app);

// Routes
app.use('/health', healthRoutes);
app.use('/', oidcRoutes);        // /.well-known/jwks.json (root-level OIDC discovery)
app.use('/oauth', oauthRoutes);
app.use('/oauth', oidcRoutes);   // /oauth/userinfo, /oauth/introspect, /oauth/logout
app.use('/auth', authRoutes);
app.use('/clients', clientRoutes);
app.use('/users', userRoutes);

// Error handling
app.use(errorHandler);

// ==============================================
// Bootstrap: ensure system OAuth client exists
// ==============================================
async function ensureSystemClient(): Promise<void> {
    try {
        await prisma.oAuthClient.upsert({
            where: { clientId: 'system-internal' },
            update: {},
            create: {
                clientId: 'system-internal',
                clientSecret: 'system-internal-not-used',
                name: 'System Internal Client',
                redirectUris: [],
                grants: [],
                scopes: ['profile', 'email', 'internal', 'government'],
                isActive: true,
            },
        });
        logger.info('System OAuth client ready');
    } catch (error) {
        logger.error('Failed to ensure system client', { error });
    }
}

// ==============================================
// Token cleanup scheduler (every 1 hour)
// ==============================================
function startTokenCleanup(): void {
    const interval = parseInt(process.env['TOKEN_CLEANUP_INTERVAL_MS'] ?? '3600000', 10);
    setInterval(async () => {
        try {
            const count = await tokenService.cleanupExpiredTokens();
            if (count > 0) {
                logger.info(`Cleaned up ${count} expired tokens`);
            }
        } catch (error) {
            logger.error('Token cleanup failed', { error });
        }
    }, interval);
    logger.info(`Token cleanup scheduled every ${interval}ms`);
}

// ==============================================
// Graceful shutdown
// ==============================================
async function shutdown(): Promise<void> {
    logger.info('Shutting down auth-service...');
    await disconnectAllDatabases();
    await disconnectRedis();
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ==============================================
// Start server
// ==============================================
async function start(): Promise<void> {
    await connectRedis();
    await ensureSystemClient();

    app.listen(PORT, () => {
        logger.info(`Auth Service running on port ${PORT}`);
        logger.info(`Health check: http://localhost:${PORT}/health`);
    });

    startTokenCleanup();
}

start().catch((error) => {
    logger.error('Failed to start auth-service', { error });
    process.exit(1);
});

export { app };
