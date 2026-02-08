// ==============================================
// Multi-Database Client Manager
// ==============================================
// Centralized database connection management for
// multiple Prisma clients.
// ==============================================

import { createLogger } from './logger.js';

const logger = createLogger('database');

export interface DatabaseConfig {
    name: string;
    url: string;
    enabled: boolean;
}

export interface DatabaseHealth {
    name: string;
    connected: boolean;
    latencyMs?: number;
    error?: string;
}

/**
 * Base class for database client management
 */
export abstract class DatabaseManager<T> {
    protected client: T | null = null;
    protected readonly name: string;
    protected readonly url: string;

    constructor(name: string, url: string) {
        this.name = name;
        this.url = url;
    }

    abstract createClient(): T;

    getClient(): T {
        if (!this.client) {
            this.client = this.createClient();
            logger.info(`Database client created: ${this.name}`);
        }
        return this.client;
    }

    abstract disconnect(): Promise<void>;

    abstract healthCheck(): Promise<DatabaseHealth>;
}

/**
 * Multi-database registry
 */
export class DatabaseRegistry {
    private static managers: Map<string, DatabaseManager<unknown>> = new Map();

    static register<T>(name: string, manager: DatabaseManager<T>): void {
        this.managers.set(name, manager);
        logger.info(`Database registered: ${name}`);
    }

    static get<T>(name: string): T {
        const manager = this.managers.get(name);
        if (!manager) {
            throw new Error(`Database not registered: ${name}`);
        }
        return manager.getClient() as T;
    }

    static async disconnectAll(): Promise<void> {
        const promises = Array.from(this.managers.values()).map((m) => m.disconnect());
        await Promise.all(promises);
        logger.info('All database connections closed');
    }

    static async healthCheckAll(): Promise<DatabaseHealth[]> {
        const promises = Array.from(this.managers.values()).map((m) => m.healthCheck());
        return Promise.all(promises);
    }
}

export { createLogger };
