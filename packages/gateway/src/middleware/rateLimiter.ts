import rateLimit from 'express-rate-limit';

const windowMs = parseInt(process.env['RATE_LIMIT_WINDOW_MS'] ?? '60000', 10);
const max = parseInt(process.env['RATE_LIMIT_MAX_REQUESTS'] ?? '100', 10);

export const rateLimiter = rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests, please try again later.',
        },
    },
    keyGenerator: (req) => {
        // Use client IP or OAuth client ID if available
        return req.headers['x-forwarded-for'] as string
            ?? req.socket.remoteAddress
            ?? 'unknown';
    },
});
