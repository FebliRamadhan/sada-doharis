// ==============================================
// Multi-Database Configuration
// ==============================================
// Simplified multi-database setup using Prisma
// ==============================================

import { PrismaClient } from '@prisma/client';
import { createLogger } from '@sada/shared';

const logger = createLogger('database');

// Database health check result
export interface DatabaseHealth {
    name: string;
    connected: boolean;
    latencyMs?: number;
    error?: string;
}

// ==============================================
// Auth Database Client (Primary)
// ==============================================
let authClient: PrismaClient | null = null;

export function getAuthDb(): PrismaClient {
    if (!authClient) {
        const url = process.env['DATABASE_AUTH_URL'] ?? process.env['DATABASE_URL'];
        authClient = new PrismaClient({
            datasourceUrl: url,
            log: process.env['NODE_ENV'] === 'development'
                ? ['query', 'info', 'warn', 'error']
                : ['error'],
        });
        logger.info('Auth database client created');
    }
    return authClient;
}

// ==============================================
// Main Database Client (Business Data)
// ==============================================
let mainClient: PrismaClient | null = null;

export function getMainDb(): PrismaClient {
    if (!mainClient) {
        const url = process.env['DATABASE_MAIN_URL'];
        if (!url) {
            throw new Error('DATABASE_MAIN_URL is not configured');
        }
        mainClient = new PrismaClient({
            datasourceUrl: url,
            log: process.env['NODE_ENV'] === 'development' ? ['error'] : ['error'],
        });
        logger.info('Main database client created');
    }
    return mainClient;
}

// ==============================================
// Reporting Database Client (Analytics)
// ==============================================
let reportingClient: PrismaClient | null = null;

export function getReportingDb(): PrismaClient {
    if (!reportingClient) {
        const url = process.env['DATABASE_REPORTING_URL'];
        if (!url) {
            throw new Error('DATABASE_REPORTING_URL is not configured');
        }
        reportingClient = new PrismaClient({
            datasourceUrl: url,
            log: ['error'],
        });
        logger.info('Reporting database client created');
    }
    return reportingClient;
}

// ==============================================
// Database Health Checks
// ==============================================
export async function checkDatabaseHealth(
    name: string,
    client: PrismaClient
): Promise<DatabaseHealth> {
    const start = Date.now();
    try {
        await client.$queryRaw`SELECT 1`;
        return {
            name,
            connected: true,
            latencyMs: Date.now() - start,
        };
    } catch (error) {
        return {
            name,
            connected: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

export async function checkAllDatabasesHealth(): Promise<DatabaseHealth[]> {
    const results: DatabaseHealth[] = [];

    // Check auth database
    try {
        results.push(await checkDatabaseHealth('auth', getAuthDb()));
    } catch (error) {
        results.push({
            name: 'auth',
            connected: false,
            error: error instanceof Error ? error.message : 'Not configured'
        });
    }

    // Check main database if configured
    if (process.env['DATABASE_MAIN_URL']) {
        try {
            results.push(await checkDatabaseHealth('main', getMainDb()));
        } catch (error) {
            results.push({
                name: 'main',
                connected: false,
                error: error instanceof Error ? error.message : 'Not configured'
            });
        }
    }

    // Check reporting database if configured
    if (process.env['DATABASE_REPORTING_URL']) {
        try {
            results.push(await checkDatabaseHealth('reporting', getReportingDb()));
        } catch (error) {
            results.push({
                name: 'reporting',
                connected: false,
                error: error instanceof Error ? error.message : 'Not configured'
            });
        }
    }

    return results;
}

// ==============================================
// Disconnect All Databases
// ==============================================
export async function disconnectAllDatabases(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (authClient) {
        promises.push(authClient.$disconnect());
        authClient = null;
    }

    if (mainClient) {
        promises.push(mainClient.$disconnect());
        mainClient = null;
    }

    if (reportingClient) {
        promises.push(reportingClient.$disconnect());
        reportingClient = null;
    }

    await Promise.all(promises);
    logger.info('All database connections closed');
}

// ==============================================
// Backward Compatibility Export
// ==============================================
export const prisma = getAuthDb();
