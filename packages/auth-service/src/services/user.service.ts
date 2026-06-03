import bcrypt from 'bcryptjs';
import { prisma } from '../config/database.js';
import { ldapService } from './ldap.service.js';
import { splpService } from './splp.service.js';
import { tokenService } from './token.service.js';
import { pegawaiService } from './pegawai.service.js';
import { auditService, AUDIT_ACTIONS } from './audit.service.js';
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

const MAX_FAILED_ATTEMPTS = parseInt(process.env['MAX_FAILED_LOGIN_ATTEMPTS'] ?? '5', 10);
const LOCKOUT_DURATION_MS = parseInt(process.env['LOGIN_LOCKOUT_MINUTES'] ?? '15', 10) * 60 * 1000;

async function recordFailedAttempt(userId: string): Promise<void> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: { increment: 1 } },
    select: { failedLoginAttempts: true, email: true },
  });

  if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
    await prisma.user.update({
      where: { id: userId },
      data: { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) },
    });
    logger.warn('Account locked after too many failed attempts', {
      userId,
      email: user.email,
      attempts: user.failedLoginAttempts,
    });
    void auditService.log({
      action: AUDIT_ACTIONS.ACCOUNT_LOCKED,
      userId,
      details: { attempts: user.failedLoginAttempts, lockoutMs: LOCKOUT_DURATION_MS },
    });
  }
}

async function resetFailedAttempts(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
}

function assertNotLocked(user: { lockedUntil: Date | null; email: string }): void {
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    logger.warn('Login attempt on locked account', { email: user.email, minutesLeft });
    throw new UnauthorizedError(
      `Account locked due to too many failed login attempts. Try again in ${minutesLeft} minute(s).`
    );
  }
}

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
  async loginWithPassword(emailOrUsername: string, password: string) {
    // If no @ sign, treat as bare username → try LDAP directly
    if (!emailOrUsername.includes('@') && ldapService.isConfigured()) {
      logger.info('Username without domain detected, using LDAP auth', {
        username: emailOrUsername,
      });
      return this.loginWithLdap(emailOrUsername, password);
    }

    const email = emailOrUsername;

    // Check if this is an internal email - authenticate via LDAP
    if (pegawaiService.isInternalEmail(email) && ldapService.isConfigured()) {
      logger.info('Internal email detected, using LDAP auth', { email });

      // Enforce lockout BEFORE touching LDAP so we don't hammer the directory
      const lockCandidate = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, lockedUntil: true },
      });
      if (lockCandidate) assertNotLocked(lockCandidate);

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
            OR: [{ ldapDn: ldapUser.dn }, { email: ldapUser.mail || email }],
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
          // Always update email to fix legacy @internal entries
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              email: userData.email,
              name: userData.name,
              ldapDn: ldapUser.dn,
              providerId: userData.providerId,
            },
          });
        }

        await resetFailedAttempts(user.id);

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
        if (lockCandidate) await recordFailedAttempt(lockCandidate.id);
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

    assertNotLocked(user);

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      await recordFailedAttempt(user.id);
      throw new UnauthorizedError('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedError('User account is inactive');
    }

    await resetFailedAttempts(user.id);
    logger.info('User logged in', { userId: user.id });

    return this.sanitizeUser(user);
  },

  /**
   * Login with LDAP
   */
  async loginWithLdap(username: string, password: string) {
    // Pre-check lockout state for known users so brute-force on bare usernames
    // is rate-limited too. Username might match either uid (ldapDn) or email prefix.
    const internalDomain = process.env['INTERNAL_EMAIL_DOMAIN'] ?? 'bpjstk.go.id';
    const probableEmail = `${username}@${internalDomain}`;
    const preLockUser = await prisma.user.findFirst({
      where: { OR: [{ email: probableEmail }, { providerId: username, provider: 'ldap' }] },
      select: { id: true, email: true, lockedUntil: true },
    });
    if (preLockUser) assertNotLocked(preLockUser);

    let ldapUser;
    try {
      ldapUser = await ldapService.authenticate(username, password);
    } catch (error) {
      if (preLockUser) await recordFailedAttempt(preLockUser.id);
      throw error;
    }

    const resolvedEmail = ldapUser.mail || `${ldapUser.uid}@${internalDomain}`;

    // Find or create user
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { ldapDn: ldapUser.dn },
          { email: ldapUser.mail || undefined },
          { email: resolvedEmail },
        ],
      },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: resolvedEmail,
          name: ldapUser.cn,
          userType: UserType.INTERNAL,
          ldapDn: ldapUser.dn,
          provider: 'ldap',
          providerId: ldapUser.uid,
        },
      });
      logger.info('LDAP user created', { userId: user.id });
    } else {
      // Update LDAP info + fix legacy @internal emails
      const updateData: Record<string, string> = {
        name: ldapUser.cn,
        ldapDn: ldapUser.dn,
      };
      if (user.email.endsWith('@internal')) {
        updateData['email'] = resolvedEmail;
        logger.info('Fixing legacy @internal email', {
          oldEmail: user.email,
          newEmail: resolvedEmail,
        });
      }
      user = await prisma.user.update({
        where: { id: user.id },
        data: updateData,
      });
    }

    await resetFailedAttempts(user.id);
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
        OR: [{ providerId: splpUser.nip, provider: 'splp' }, { email: splpUser.email }],
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
  sanitizeUser(user: {
    id: string;
    email: string;
    name: string;
    userType: string;
    isActive: boolean;
    createdAt: Date;
    password?: string | null;
  }) {
    const { password, ...sanitized } = user;
    return {
      ...sanitized,
      userType: sanitized.userType as UserType,
    };
  },
};
