import winston from 'winston';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom log format
const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;

    if (Object.keys(meta).length > 0) {
        log += ` ${JSON.stringify(meta)}`;
    }

    if (stack) {
        log += `\n${stack}`;
    }

    return log;
});

// Create logger instance
export const createLogger = (service: string) => {
    return winston.createLogger({
        level: process.env['LOG_LEVEL'] ?? 'info',
        defaultMeta: { service },
        format: combine(
            errors({ stack: true }),
            timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            logFormat
        ),
        transports: [
            new winston.transports.Console({
                format: combine(
                    colorize(),
                    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                    logFormat
                ),
            }),
        ],
    });
};

// Default logger
export const logger = createLogger('app');
