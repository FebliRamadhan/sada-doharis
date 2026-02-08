import bcrypt from 'bcryptjs';
import { prisma } from '../config/database.js';
import { ldapService } from './ldap.service.js';
import { splpService } from './splp.service.js';
import { tokenService } from './token.service.js';
import { pegawaiService } from './pegawai.service.js';
import {
    UserType,
    UnauthorizedError,
    NotFoundError,
    ConflictError,
    createLogger,
    type UserCreate,
    type SplpUser,
    type LdapUser,
} from '@sada/shared';

const logger = createLogger('user-service');
const SALT_ROUNDS = 12;

export const userService = {
    /**
     * Register new user with email/password
     */
    async register(data: UserCreate) {
        // Check if user exists
        const existing = await prisma.user.findUnique({
            where: { email: data.email },
        });

        if (existing) {
            throw new ConflictError('User with this email already exists');
        }

        // Hash password if provided
        let hashedPassword: string | undefined;
        if (data.password) {
            hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);
        }

        const user = await prisma.user.create({
            data: {
                email: data.email,
                password: hashedPassword,
                name: data.name,
                userType: data.userType ?? UserType.EXTERNAL,
                provider: data.provider ?? 'local',
                providerId: data.providerId,
            },
        });

        logger.info('User registered', { userId: user.id, email: user.email });

        return this.sanitizeUser(user);
    },

    /**
     * Login with email and password
     * For internal emails (@bpjstk.go.id), it authenticates via LDAP
     * and fetches profile from tb_master_pegawai
     */
    async loginWithPassword(email: string, password: string) {
        // Check if this is an internal email - authenticate via LDAP
        if (pegawaiService.isInternalEmail(email) && ldapService.isConfigured()) {
            logger.info('Internal email detected, using LDAP auth', { email });

            try {
                // Extract username from email for LDAP
                const username = email.split('@')[0];
                const ldapUser = await ldapService.authenticate(username, password);

                // Fetch additional profile from tb_master_pegawai
                let pegawaiProfile = null;
                if (pegawaiService.isConfigured()) {
                    pegawaiProfile = await pegawaiService.getByEmail(email);
                }

                // Find or create user
                let user = await prisma.user.findFirst({
                    where: {
                        OR: [
                            { ldapDn: ldapUser.dn },
                            { email: ldapUser.mail || email },
                        ],
                    },
                });

                const userData = {
                    email: ldapUser.mail || email,
                    name: pegawaiProfile?.nama || ldapUser.cn,
                    userType: UserType.INTERNAL,
                    ldapDn: ldapUser.dn,
                    provider: 'ldap',
                    providerId: pegawaiProfile?.nip || ldapUser.uid,
                };

                if (!user) {
                    user = await prisma.user.create({ data: userData });
                    logger.info('Internal user created via LDAP', { userId: user.id });
                } else {
                    user = await prisma.user.update({
                        where: { id: user.id },
                        data: {
                            name: userData.name,
                            ldapDn: ldapUser.dn,
                            providerId: userData.providerId,
                        },
                    });
                }

                const sanitizedUser = this.sanitizeUser(user);

                // Add pegawai profile metadata if available
                if (pegawaiProfile) {
                    return {
                        ...sanitizedUser,
                        pegawai: pegawaiProfile,
                    };
                }

                return sanitizedUser;
            } catch (error) {
                logger.warn('LDAP auth failed for internal email', { email, error });
                throw new UnauthorizedError('Invalid credentials');
            }
        }

        // Standard email/password login for external users
        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user || !user.password) {
            throw new UnauthorizedError('Invalid credentials');
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            throw new UnauthorizedError('Invalid credentials');
        }

        if (!user.isActive) {
            throw new UnauthorizedError('User account is inactive');
        }

        logger.info('User logged in', { userId: user.id });

        return this.sanitizeUser(user);
    },

    /**
     * Login with LDAP
     */
    async loginWithLdap(username: string, password: string) {
        const ldapUser = await ldapService.authenticate(username, password);

        // Find or create user
        let user = await prisma.user.findFirst({
            where: {
                OR: [
                    { ldapDn: ldapUser.dn },
                    { email: ldapUser.mail },
                ],
            },
        });

        if (!user) {
            user = await prisma.user.create({
                data: {
                    email: ldapUser.mail || `${ldapUser.uid}@internal`,
                    name: ldapUser.cn,
                    userType: UserType.INTERNAL,
                    ldapDn: ldapUser.dn,
                    provider: 'ldap',
                    providerId: ldapUser.uid,
                },
            });
            logger.info('LDAP user created', { userId: user.id });
        } else {
            // Update LDAP info
            user = await prisma.user.update({
                where: { id: user.id },
                data: {
                    name: ldapUser.cn,
                    ldapDn: ldapUser.dn,
                },
            });
        }

        return this.sanitizeUser(user);
    },

    /**
     * Login/Register with SPLP
     */
    async loginWithSplp(code: string) {
        const tokens = await splpService.exchangeCode(code);
        const splpUser = await splpService.getUserInfo(tokens.accessToken);

        // Find or create user
        let user = await prisma.user.findFirst({
            where: {
                OR: [
                    { providerId: splpUser.nip, provider: 'splp' },
                    { email: splpUser.email },
                ],
            },
        });

        if (!user) {
            user = await prisma.user.create({
                data: {
                    email: splpUser.email,
                    name: splpUser.nama,
                    userType: UserType.GOVERNMENT,
                    provider: 'splp',
                    providerId: splpUser.nip,
                },
            });
            logger.info('SPLP user created', { userId: user.id, nip: splpUser.nip });
        } else {
            // Update user info
            user = await prisma.user.update({
                where: { id: user.id },
                data: {
                    name: splpUser.nama,
                    userType: UserType.GOVERNMENT,
                },
            });
        }

        return this.sanitizeUser(user);
    },

    /**
     * Find user by ID
     */
    async findById(id: string) {
        const user = await prisma.user.findUnique({
            where: { id },
        });

        if (!user) {
            throw new NotFoundError('User', id);
        }

        return this.sanitizeUser(user);
    },

    /**
     * Find user by email
     */
    async findByEmail(email: string) {
        const user = await prisma.user.findUnique({
            where: { email },
        });

        return user ? this.sanitizeUser(user) : null;
    },

    /**
     * Update user
     */
    async update(id: string, data: Partial<Pick<UserCreate, 'name' | 'email'>>) {
        const user = await prisma.user.update({
            where: { id },
            data,
        });

        logger.info('User updated', { userId: id });

        return this.sanitizeUser(user);
    },

    /**
     * Deactivate user
     */
    async deactivate(id: string) {
        await prisma.user.update({
            where: { id },
            data: { isActive: false },
        });

        logger.info('User deactivated', { userId: id });
    },

    /**
     * Remove sensitive fields from user object
     */
    sanitizeUser(user: { id: string; email: string; name: string; userType: string; isActive: boolean; createdAt: Date; password?: string | null }) {
        const { password, ...sanitized } = user;
        return {
            ...sanitized,
            userType: sanitized.userType as UserType,
        };
    },
};
