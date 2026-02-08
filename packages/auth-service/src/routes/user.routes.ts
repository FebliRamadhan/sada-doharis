import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { userService } from '../services/user.service.js';
import { sendSuccess, ValidationError } from '@sada/shared';

const router = Router();

// Validation schemas
const updateUserSchema = z.object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
});

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     summary: Get user by ID
 *     description: Retrieve user details by their unique identifier
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     responses:
 *       200:
 *         description: User details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = await userService.findById(req.params['id'] as string);
        sendSuccess(res, user);
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /users/{id}:
 *   patch:
 *     summary: Update user
 *     description: Update user profile information
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "John Doe"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "john@example.com"
 *     responses:
 *       200:
 *         description: Updated user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       404:
 *         description: User not found
 */
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = updateUserSchema.safeParse(req.body);

        if (!parsed.success) {
            throw new ValidationError('Invalid request', parsed.error.flatten().fieldErrors);
        }

        const user = await userService.update(req.params['id'] as string, parsed.data);
        sendSuccess(res, user);
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /users/{id}:
 *   delete:
 *     summary: Deactivate user
 *     description: Deactivate a user account (soft delete)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     responses:
 *       200:
 *         description: User deactivated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     deactivated:
 *                       type: boolean
 *       404:
 *         description: User not found
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        await userService.deactivate(req.params['id'] as string);
        sendSuccess(res, { deactivated: true });
    } catch (error) {
        next(error);
    }
});

export { router as userRoutes };
