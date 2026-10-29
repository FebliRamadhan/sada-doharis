import bcrypt from 'bcryptjs';
import { prisma } from '../config/database.js';
import { ldapService, LdapAuthError } from './ldap.service.js';
import { splpService } from './splp.service.js';
import { tokenService } from './token.service.js';
import { pegawaiService } from './pegawai.service.js';
import { auditService, AUDIT_ACTIONS } from './audit.service.js';
import {
  getPasswordExpiry,
  passwordStatusWhere,
  type PasswordStatus,
} from './password-expiry.service.js';
import {
  AppError,
  ErrorCodes,
  ForbiddenError,
  UserType,
  UnauthorizedError,
  NotFoundError,
  ConflictError,
  createLogger,
  type UserCreate,
  type SplpUser,
  type LdapUser,
  type LdapDirectory,
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

/**
 * Perubahan password terakhir yang diketahui: yang paling akhir antara catatan
 * SADA dan `zimbraPasswordModifiedTime`, supaya ganti password lewat webmail
 * juga terhitung (CONTEXT.md — Masa Berlaku Password).
 */
function latestPasswordChange(
  known: Date | null | undefined,
  fromDirectory: Date | undefined
): Date | undefined {
  if (!fromDirectory) return known ?? undefined;
  return known && known > fromDirectory ? known : fromDirectory;
}

/**
 * Direktori ditemukan di tempat lain daripada yang mengikat akun
 * (docs/adr/0004). Password-nya benar, jadi ini bukan kegagalan login yang
 * dihitung ke lockout; admin harus menjalankan Pindahkan Direktori.
 */
export class DirectoryMismatchError extends ForbiddenError {
  constructor() {
    super('Akun Anda perlu diverifikasi admin. Hubungi helpdesk.');
  }
}

/** Direktori LDAP tak terjangkau: gagal tertutup, bukan "password salah". */
function ldapUnavailable(): AppError {
  return new AppError(
    ErrorCodes.SERVICE_UNAVAILABLE,
    'Layanan login sedang bermasalah. Coba lagi beberapa saat lagi.',
    503
  );
}

/**
 * Tolak login bila user sudah terikat ke direktori lain. User lama tanpa
 * catatan (null) dianggap belum terikat dan akan diikat saat ini.
 */
async function assertDirectoryMatches(
  user: { id: string; email: string; ldapDirectory: LdapDirectory | null },
  found: LdapDirectory
): Promise<void> {
  if (!user.ldapDirectory || user.ldapDirectory === found) return;
  logger.warn('LDAP directory mismatch', {
    userId: user.id,
    bound: user.ldapDirectory,
    found,
  });
  await auditService.log({
    action: AUDIT_ACTIONS.LOGIN_DIRECTORY_MISMATCH,
    userId: user.id,
    details: { bound: user.ldapDirectory, found },
  });
  throw new DirectoryMismatchError();
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
        const ldapUser = await ldapService.authenticateAny(username, password);
        const directory = ldapUser.directory ?? 'PRIMARY';

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

        if (user) await assertDirectoryMatches(user, directory);

        const userData = {
          email: ldapUser.mail || email,
          name: pegawaiProfile?.nama || ldapUser.cn,
          userType: UserType.INTERNAL,
          ldapDn: ldapUser.dn,
          ldapDirectory: directory,
          provider: 'ldap',
          providerId: pegawaiProfile?.nip || ldapUser.uid,
        };

        if (!user) {
          user = await prisma.user.create({
            data: { ...userData, passwordChangedAt: ldapUser.passwordChangedAt },
          });
          logger.info('Internal user created via LDAP', { userId: user.id });
        } else {
          // Always update email to fix legacy @internal entries
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              email: userData.email,
              name: userData.name,
              ldapDn: ldapUser.dn,
              ldapDirectory: directory,
              providerId: userData.providerId,
              passwordChangedAt: latestPasswordChange(
                user.passwordChangedAt,
                ldapUser.passwordChangedAt
              ),
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
        // Bukan salah password: jangan dihitung ke lockout.
        if (error instanceof DirectoryMismatchError) throw error;
        if (error instanceof LdapAuthError && error.failure === 'unavailable') {
          throw ldapUnavailable();
        }
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
      ldapUser = await ldapService.authenticateAny(username, password);
    } catch (error) {
      if (error instanceof LdapAuthError && error.failure === 'unavailable') {
        throw ldapUnavailable();
      }
      if (preLockUser) await recordFailedAttempt(preLockUser.id);
      throw new UnauthorizedError('Invalid credentials');
    }
    const directory = ldapUser.directory ?? 'PRIMARY';

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

    if (user) await assertDirectoryMatches(user, directory);

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: resolvedEmail,
          name: ldapUser.cn,
          userType: UserType.INTERNAL,
          ldapDn: ldapUser.dn,
          ldapDirectory: directory,
          provider: 'ldap',
          providerId: ldapUser.uid,
          passwordChangedAt: ldapUser.passwordChangedAt,
        },
      });
      logger.info('LDAP user created', { userId: user.id });
    } else {
      // Update LDAP info + fix legacy @internal emails
      const updateData: Record<string, string | Date | undefined> = {
        name: ldapUser.cn,
        ldapDn: ldapUser.dn,
        ldapDirectory: directory,
        passwordChangedAt: latestPasswordChange(user.passwordChangedAt, ldapUser.passwordChangedAt),
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

  /** Admin: paginated user list with optional name/email search. */
  async list(opts: {
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
    userType?: UserType;
    mfaEnabled?: boolean;
    passwordStatus?: PasswordStatus;
    ldapDirectory?: LdapDirectory;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const search = opts.search?.trim();

    // Satu `where` dipakai bersama oleh daftar dan seluruh hitungannya, supaya
    // kartu statistik selalu berbicara tentang himpunan yang sedang dilihat.
    const where: Record<string, unknown> = {};
    if (search) {
      where['OR'] = [
        { email: { contains: search, mode: 'insensitive' as const } },
        { name: { contains: search, mode: 'insensitive' as const } },
      ];
    }
    if (opts.isActive !== undefined) where['isActive'] = opts.isActive;
    if (opts.userType) where['userType'] = opts.userType;
    if (opts.mfaEnabled !== undefined) where['mfaEnabled'] = opts.mfaEnabled;
    if (opts.ldapDirectory) where['ldapDirectory'] = opts.ldapDirectory;
    if (opts.passwordStatus) {
      // Digabung lewat AND karena filter status password sendiri memakai OR/NOT.
      where['AND'] = [passwordStatusWhere(opts.passwordStatus)];
    }

    const [users, total, activeCount] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          email: true,
          name: true,
          userType: true,
          isActive: true,
          provider: true,
          mfaEnabled: true,
          passwordChangedAt: true,
          passwordMustChange: true,
          ldapDirectory: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
      // Counted in the database, under the SAME `where` as the listing, so the
      // tiles describe the whole filtered set rather than the rows on screen.
      prisma.user.count({ where: { ...where, isActive: true } }),
    ]);

    return {
      users: users.map((u) => ({ ...u, passwordExpiry: getPasswordExpiry(u) })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        activeCount,
        inactiveCount: total - activeCount,
      },
    };
  },

  /** Admin: activate/deactivate any user account. */
  async setActive(id: string, isActive: boolean) {
    const user = await prisma.user.update({
      where: { id },
      data: { isActive },
      select: { id: true, email: true, name: true, userType: true, isActive: true },
    });
    logger.info('User active status changed', { userId: id, isActive });
    return user;
  },

  /**
   * Admin: Wajibkan Ganti Password (CONTEXT.md). Hanya menandai — password di
   * Zimbra tidak disentuh; pemanggil mencabut sesi user.
   */
  async requirePasswordChange(id: string) {
    const target = await prisma.user.findUnique({ where: { id }, select: { userType: true } });
    if (!target) throw new NotFoundError('User', id);
    if (target.userType !== UserType.INTERNAL) {
      throw new ConflictError('Masa berlaku password hanya berlaku untuk user INTERNAL');
    }
    const user = await prisma.user.update({
      where: { id },
      data: { passwordMustChange: true },
      select: {
        id: true,
        email: true,
        userType: true,
        passwordChangedAt: true,
        passwordMustChange: true,
      },
    });
    logger.info('Password change required by admin', { userId: id });
    return { ...user, passwordExpiry: getPasswordExpiry(user) };
  },

  /**
   * Admin: Pindahkan Direktori (CONTEXT.md, docs/adr/0004). Hanya mengganti
   * direktori yang mengikat user; pemanggil mencabut sesinya. Login berikutnya
   * harus berhasil di direktori yang baru.
   */
  async moveLdapDirectory(id: string, directory: LdapDirectory) {
    const target = await prisma.user.findUnique({
      where: { id },
      select: { userType: true, ldapDirectory: true },
    });
    if (!target) throw new NotFoundError('User', id);
    if (target.userType !== UserType.INTERNAL) {
      throw new ConflictError('Direktori hanya berlaku untuk user INTERNAL');
    }
    if ((target.ldapDirectory ?? 'PRIMARY') === directory) {
      throw new ConflictError('User sudah terikat ke direktori ini');
    }
    if (directory === 'SECONDARY' && !ldapService.isSecondaryConfigured()) {
      throw new ConflictError('Direktori secondary belum dikonfigurasi');
    }
    const user = await prisma.user.update({
      where: { id },
      data: { ldapDirectory: directory },
      select: { id: true, email: true, userType: true, ldapDirectory: true },
    });
    logger.info('LDAP directory moved by admin', {
      userId: id,
      from: target.ldapDirectory,
      to: directory,
    });
    return { user, from: target.ldapDirectory };
  },

  /** Whether an email maps to a resettable local-password account. */
  async hasLocalPassword(email: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { password: true },
    });
    return Boolean(user?.password);
  },

  /**
   * Reset a local user's password. Only applies to users that have a local
   * password (local/external); LDAP/SPLP/social accounts have none to reset.
   * Also clears any lockout. Returns false when there is no resettable account.
   */
  async resetPassword(email: string, newPassword: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, password: true },
    });
    if (!user || !user.password) return false;

    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, failedLoginAttempts: 0, lockedUntil: null },
    });
    logger.info('Password reset', { userId: user.id });
    return true;
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
    mfaEnabled?: boolean;
    mfaSecret?: string | null;
    mfaBackupCodes?: string[];
    mfaEnabledAt?: Date | null;
    passwordChangedAt?: Date | null;
    passwordMustChange?: boolean;
  }) {
    // Never leak the TOTP secret or backup-code hashes. mfaEnabled is safe to expose
    // (the login flow and admin UI need it).
    const { password, mfaSecret, mfaBackupCodes, ...sanitized } = user;
    void mfaSecret;
    void mfaBackupCodes;
    return {
      ...sanitized,
      mfaEnabled: sanitized.mfaEnabled ?? false,
      userType: sanitized.userType as UserType,
      passwordExpiry: getPasswordExpiry(user),
    };
  },
};
