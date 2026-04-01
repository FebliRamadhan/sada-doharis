import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { createLogger } from '@sada/shared';

const logger = createLogger('audit');

export const AUDIT_ACTIONS = {
    LOGIN: 'LOGIN',
    LOGIN_FAILED: 'LOGIN_FAILED',
    LOGIN_LDAP: 'LOGIN_LDAP',
    LOGIN_SPLP: 'LOGIN_SPLP',
    LOGIN_GOOGLE: 'LOGIN_GOOGLE',
    LOGIN_FACEBOOK: 'LOGIN_FACEBOOK',
    REGISTER: 'REGISTER',
    LOGOUT: 'LOGOUT',
    TOKEN_ISSUED: 'TOKEN_ISSUED',
    TOKEN_REVOKED: 'TOKEN_REVOKED',
    TOKEN_REFRESHED: 'TOKEN_REFRESHED',
    CLIENT_CREATED: 'CLIENT_CREATED',
    CLIENT_DELETED: 'CLIENT_DELETED',
    CLIENT_SECRET_REGENERATED: 'CLIENT_SECRET_REGENERATED',
} as const;

export type AuditAction = typeof AUDIT_ACTIONS[keyof typeof AUDIT_ACTIONS];

export const auditService = {
    async log(data: {
        action: AuditAction | string;
        userId?: string;
        clientId?: string;
        ip?: string;
        userAgent?: string;
        details?: Prisma.InputJsonValue;
    }): Promise<void> {
        if (process.env['AUDIT_LOG_ENABLED'] !== 'true') return;

        try {
            await prisma.auditLog.create({ data });
        } catch (error) {
            // Never let audit logging break the main flow
            logger.error('Audit log write failed', { error: (error as Error).message });
        }
    },
};
