import bcrypt from 'bcryptjs';
import { prisma } from '../config/database.js';
import { tokenService } from './token.service.js';
import {
    NotFoundError,
    ConflictError,
    createLogger,
    type OAuthClientCreate,
    type OAuthGrantType,
} from '@sada/shared';

const logger = createLogger('client-service');
const SALT_ROUNDS = 12;

export const clientService = {
    /**
     * Create new OAuth client
     */
    async create(data: OAuthClientCreate) {
        const credentials = tokenService.generateClientCredentials();

        // Hash client secret before storing
        const hashedSecret = await bcrypt.hash(credentials.clientSecret, SALT_ROUNDS);

        const client = await prisma.oAuthClient.create({
            data: {
                clientId: credentials.clientId,
                clientSecret: hashedSecret,
                name: data.name,
                redirectUris: data.redirectUris,
                grants: data.grants,
                scopes: data.scopes,
            },
        });

        logger.info('OAuth client created', { clientId: credentials.clientId, name: data.name });

        // Return plain secret only on creation
        return {
            id: client.id,
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret, // Plain secret - show only once
            name: client.name,
            redirectUris: client.redirectUris,
            grants: client.grants,
            scopes: client.scopes,
            createdAt: client.createdAt,
        };
    },

    /**
     * Find client by ID
     */
    async findById(id: string) {
        const client = await prisma.oAuthClient.findUnique({
            where: { id },
        });

        if (!client) {
            throw new NotFoundError('OAuth Client', id);
        }

        return this.sanitizeClient(client);
    },

    /**
     * Find client by clientId
     */
    async findByClientId(clientId: string) {
        const client = await prisma.oAuthClient.findUnique({
            where: { clientId },
        });

        return client ? this.sanitizeClient(client) : null;
    },

    /**
     * List all clients
     */
    async list(page: number = 1, limit: number = 10) {
        const skip = (page - 1) * limit;

        const [clients, total] = await Promise.all([
            prisma.oAuthClient.findMany({
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            prisma.oAuthClient.count(),
        ]);

        return {
            data: clients.map((c: typeof clients[number]) => this.sanitizeClient(c)),
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    },

    /**
     * Update client
     */
    async update(id: string, data: Partial<OAuthClientCreate>) {
        const client = await prisma.oAuthClient.update({
            where: { id },
            data: {
                name: data.name,
                redirectUris: data.redirectUris,
                grants: data.grants,
                scopes: data.scopes,
            },
        });

        logger.info('OAuth client updated', { clientId: id });

        return this.sanitizeClient(client);
    },

    /**
     * Regenerate client secret
     */
    async regenerateSecret(id: string) {
        const credentials = tokenService.generateClientCredentials();
        const hashedSecret = await bcrypt.hash(credentials.clientSecret, SALT_ROUNDS);

        const client = await prisma.oAuthClient.update({
            where: { id },
            data: {
                clientSecret: hashedSecret,
            },
        });

        logger.info('OAuth client secret regenerated', { clientId: id });

        return {
            ...this.sanitizeClient(client),
            clientSecret: credentials.clientSecret, // Plain secret - show only once
        };
    },

    /**
     * Deactivate client
     */
    async deactivate(id: string) {
        await prisma.oAuthClient.update({
            where: { id },
            data: { isActive: false },
        });

        logger.info('OAuth client deactivated', { clientId: id });
    },

    /**
     * Delete client
     */
    async delete(id: string) {
        // Delete associated tokens first
        await prisma.oAuthToken.deleteMany({
            where: { clientId: id },
        });

        await prisma.oAuthAuthorizationCode.deleteMany({
            where: { clientId: id },
        });

        await prisma.oAuthClient.delete({
            where: { id },
        });

        logger.info('OAuth client deleted', { clientId: id });
    },

    /**
     * Validate client credentials
     */
    async validateCredentials(clientId: string, clientSecret: string) {
        const client = await prisma.oAuthClient.findUnique({
            where: { clientId },
        });

        if (!client || !client.isActive) {
            return null;
        }

        const isValid = await bcrypt.compare(clientSecret, client.clientSecret);
        if (!isValid) {
            return null;
        }

        return client;
    },

    /**
     * Remove sensitive fields from client object
     */
    sanitizeClient(client: {
        id: string;
        clientId: string;
        name: string;
        redirectUris: string[];
        grants: string[];
        scopes: string[];
        isActive: boolean;
        createdAt: Date;
        clientSecret?: string;
    }) {
        const { clientSecret, ...sanitized } = client;
        return sanitized;
    },
};
