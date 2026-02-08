import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import compression from 'compression';
import { createLogger } from '@sada/shared';

import { errorHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { authRoutes } from './routes/auth.routes.js';
import { proxyRoutes } from './routes/proxy.routes.js';
import { healthRoutes } from './routes/health.routes.js';

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

// Rate limiting
app.use(rateLimiter);

// Routes
app.use('/health', healthRoutes);
app.use('/auth', authRoutes);
app.use('/api', proxyRoutes);

// Error handling
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
    logger.info(`🚀 API Gateway running on port ${PORT}`);
    logger.info(`📍 Health check: http://localhost:${PORT}/health`);
});

export { app };
