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
import { initPassport } from './config/passport.js';
import { setupSwagger } from './swagger.js';

const logger = createLogger('auth-service');
const app = express();

const PORT = process.env['AUTH_SERVICE_PORT'] ?? 3001;

// Security middlewares
app.use(helmet());
app.use(cors({
    origin: process.env['CORS_ORIGIN']?.split(',') ?? '*',
    credentials: true,
}));

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
app.use('/oauth', oauthRoutes);
app.use('/auth', authRoutes);
app.use('/clients', clientRoutes);
app.use('/users', userRoutes);

// Error handling
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
    logger.info(`🔐 Auth Service running on port ${PORT}`);
    logger.info(`📍 Health check: http://localhost:${PORT}/health`);
});

export { app };
