import { Redis } from 'ioredis';
import { createLogger } from '@sada/shared';

const logger = createLogger('redis');

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
        redisClient.on('error', (err: Error) => logger.error('Redis error', { error: err.message }));
        redisClient.on('reconnecting', () => logger.warn('Redis reconnecting'));

        logger.info('Redis client created');
    }
    return redisClient;
}

export async function connectRedis(): Promise<void> {
    const client = getRedis();
    await client.connect();
}

export async function disconnectRedis(): Promise<void> {
    if (redisClient) {
        await redisClient.quit();
        redisClient = null;
        logger.info('Redis disconnected');
    }
}

export interface RedisHealth {
    connected: boolean;
    latencyMs?: number;
    error?: string;
}

export async function checkRedisHealth(): Promise<RedisHealth> {
    const start = Date.now();
    try {
        const client = getRedis();
        await client.ping();
        return { connected: true, latencyMs: Date.now() - start };
    } catch (error) {
        return {
            connected: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
