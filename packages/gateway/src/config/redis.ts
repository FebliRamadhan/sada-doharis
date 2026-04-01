import { Redis } from 'ioredis';
import { createLogger } from '@sada/shared';

const logger = createLogger('gateway-redis');

let redisClient: Redis | null = null;

export function getRedis(): Redis {
    if (!redisClient) {
        const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
        redisClient = new Redis(url, {
            lazyConnect: true,
            maxRetriesPerRequest: 3,
            enableReadyCheck: true,
        });

        redisClient.on('connect', () => logger.info('Redis connected'));
        redisClient.on('error', (err) => logger.error('Redis error', { error: err.message }));
        redisClient.on('reconnecting', () => logger.warn('Redis reconnecting'));
    }
    return redisClient;
}

export async function connectRedis(): Promise<void> {
    await getRedis().connect();
}

export async function disconnectRedis(): Promise<void> {
    if (redisClient) {
        await redisClient.quit();
        redisClient = null;
    }
}
