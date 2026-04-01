import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { clientService } from '../services/client.service.js';
import { sendSuccess, sendPaginated, ValidationError } from '@sada/shared';

const router = Router();

// Validation schemas
const createClientSchema = z.object({
    name: z.string().min(1),
    redirectUris: z.array(z.string().url()),
    grants: z.array(z.enum(['authorization_code', 'client_credentials', 'refresh_token'])),
    scopes: z.array(z.string()),
});

const updateClientSchema = z.object({
    name: z.string().min(1).optional(),
    redirectUris: z.array(z.string().url()).optional(),
    grants: z.array(z.enum(['authorization_code', 'client_credentials', 'refresh_token'])).optional(),
    scopes: z.array(z.string()).optional(),
});

/**
 * @swagger
 * /clients:
 *   post:
 *     summary: Create OAuth Client
 *     description: Register a new OAuth 2.0 client application
 *     tags: [Clients]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, redirectUris, grants, scopes]
 *             properties:
 *               name:
 *                 type: string
 *                 description: Client application name
 *                 example: "My Application"
 *               redirectUris:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uri
 *                 description: Allowed redirect URIs
 *                 example: ["https://app.example.com/callback"]
 *               grants:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [authorization_code, client_credentials, refresh_token]
 *                 description: Allowed grant types
 *               scopes:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Allowed scopes
 *                 example: ["openid", "profile", "email"]
 *     responses:
 *       201:
 *         description: Client created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       description: Client ID
 *                     secret:
 *                       type: string
 *                       description: Client secret (only shown once)
 *                     name:
 *                       type: string
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = createClientSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new ValidationError('Invalid request', parsed.error.flatten().fieldErrors);
        }

        const client = await clientService.create(parsed.data);
        sendSuccess(res, client, 201);
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /clients:
 *   get:
 *     summary: List OAuth Clients
 *     description: Get paginated list of all registered OAuth clients
 *     tags: [Clients]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Items per page
 *     responses:
 *       200:
 *         description: Paginated list of clients
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/OAuthClient'
 *                 meta:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const page = parseInt(req.query['page'] as string) || 1;
        const limit = parseInt(req.query['limit'] as string) || 10;

        const result = await clientService.list(page, limit);
        sendPaginated(res, result.data, result.meta.page, result.meta.limit, result.meta.total);
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /clients/{id}:
 *   get:
 *     summary: Get OAuth Client
 *     description: Get OAuth client details by ID
 *     tags: [Clients]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Client ID
 *     responses:
 *       200:
 *         description: Client details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/OAuthClient'
 *       404:
 *         description: Client not found
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        // Try lookup by OAuth clientId first (used by auth-ui), fall back to internal id
        const id = req.params['id'] as string;
        const client = (await clientService.findByClientId(id)) ?? (await clientService.findById(id));
        sendSuccess(res, client);
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /clients/{id}:
 *   patch:
 *     summary: Update OAuth Client
 *     description: Update OAuth client properties
 *     tags: [Clients]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Client ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               redirectUris:
 *                 type: array
 *                 items:
 *                   type: string
 *               grants:
 *                 type: array
 *                 items:
 *                   type: string
 *               scopes:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Updated client
 *       404:
 *         description: Client not found
 */
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = updateClientSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new ValidationError('Invalid request', parsed.error.flatten().fieldErrors);
        }

        const client = await clientService.update(req.params['id'] as string, parsed.data);
        sendSuccess(res, client);
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /clients/{id}/regenerate-secret:
 *   post:
 *     summary: Regenerate Client Secret
 *     description: Generate a new client secret (invalidates the old one)
 *     tags: [Clients]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Client ID
 *     responses:
 *       200:
 *         description: New secret generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     secret:
 *                       type: string
 *                       description: New client secret
 *       404:
 *         description: Client not found
 */
router.post('/:id/regenerate-secret', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const client = await clientService.regenerateSecret(req.params['id'] as string);
        sendSuccess(res, client);
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /clients/{id}:
 *   delete:
 *     summary: Delete OAuth Client
 *     description: Permanently delete an OAuth client
 *     tags: [Clients]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Client ID
 *     responses:
 *       200:
 *         description: Client deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     deleted:
 *                       type: boolean
 *       404:
 *         description: Client not found
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        await clientService.delete(req.params['id'] as string);
        sendSuccess(res, { deleted: true });
    } catch (error) {
        next(error);
    }
});

export { router as clientRoutes };
