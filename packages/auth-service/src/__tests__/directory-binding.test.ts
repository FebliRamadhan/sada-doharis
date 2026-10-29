import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Ikatan Direktori (docs/adr/0004): direktori pertama mengikat akun; ditemukan
 * di direktori lain ditolak tanpa dihitung ke lockout; hanya admin yang bisa
 * memindahkan, dan itu mencabut semua sesi.
 */
process.env['DATABASE_URL'] ??= 'postgresql://user:pass@127.0.0.1:5432/test?schema=public';
process.env['JWT_SECRET'] ??= 'test-secret-yang-cukup-panjang-untuk-hs256';

const db = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock('../config/database.js', () => ({ prisma: { user: db } }));

const ldap = vi.hoisted(() => ({
  authenticateAny: vi.fn(),
  isConfigured: vi.fn(() => true),
  isSecondaryConfigured: vi.fn(() => true),
}));
vi.mock('../services/ldap.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/ldap.service.js')>();
  return { ...actual, ldapService: ldap };
});

const audit = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock('../services/audit.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/audit.service.js')>();
  return { ...actual, auditService: audit };
});

vi.mock('../middleware/adminGuard.js', () => ({
  adminGuard: (_req: unknown, res: { locals: Record<string, unknown> }, next: () => void) => {
    res.locals['adminUserId'] = 'admin1';
    next();
  },
  isAdminEmail: () => true,
}));
const issuer = vi.hoisted(() => ({ revokeAllUserAccess: vi.fn() }));
vi.mock('../services/login-issuer.service.js', () => issuer);

const ldapUser = (directory: 'PRIMARY' | 'SECONDARY') => ({
  dn: 'uid=budi,ou=people,dc=menpan,dc=go,dc=id',
  uid: 'budi',
  cn: 'Budi',
  mail: 'budi@menpan.go.id',
  directory,
});

const existing = (ldapDirectory: 'PRIMARY' | 'SECONDARY' | null) => ({
  id: 'u1',
  email: 'budi@menpan.go.id',
  lockedUntil: null,
  ldapDirectory,
  passwordChangedAt: null,
});

/** Apakah ada update yang menyentuh hitungan gagal login (lockout)? */
const touchedLockout = () =>
  db.update.mock.calls.some(
    ([arg]) => (arg?.data?.failedLoginAttempts as { increment?: number })?.increment === 1
  );

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  ldap.authenticateAny.mockReset();
  ldap.isSecondaryConfigured.mockReset().mockReturnValue(true);
  audit.log.mockReset().mockResolvedValue(undefined);
  issuer.revokeAllUserAccess.mockReset().mockResolvedValue(undefined);
  db.update.mockImplementation(async ({ data }) => ({
    ...existing('PRIMARY'),
    ...data,
    failedLoginAttempts: 0,
  }));
  db.create.mockImplementation(async ({ data }) => ({ id: 'new', ...data }));
});

describe('userService.loginWithLdap: ikatan direktori', () => {
  it('user baru dari secondary diikat ke SECONDARY', async () => {
    const { userService } = await import('../services/user.service.js');
    db.findFirst.mockResolvedValue(null);
    ldap.authenticateAny.mockResolvedValue(ldapUser('SECONDARY'));

    await userService.loginWithLdap('budi', 'rahasia');

    expect(db.create.mock.calls[0]?.[0]?.data).toMatchObject({ ldapDirectory: 'SECONDARY' });
  });

  it('user lama tanpa catatan direktori diikat saat login', async () => {
    const { userService } = await import('../services/user.service.js');
    db.findFirst.mockResolvedValue(existing(null));
    ldap.authenticateAny.mockResolvedValue(ldapUser('PRIMARY'));

    await userService.loginWithLdap('budi', 'rahasia');

    expect(db.update.mock.calls.some(([a]) => a?.data?.ldapDirectory === 'PRIMARY')).toBe(true);
  });

  it('terikat PRIMARY tetapi ditemukan di SECONDARY: ditolak, dicatat, tidak dihitung lockout', async () => {
    const { userService, DirectoryMismatchError } = await import('../services/user.service.js');
    db.findFirst
      .mockResolvedValueOnce(existing('PRIMARY')) // pre-lock lookup
      .mockResolvedValueOnce(existing('PRIMARY')); // find-or-create
    ldap.authenticateAny.mockResolvedValue(ldapUser('SECONDARY'));

    await expect(userService.loginWithLdap('budi', 'rahasia')).rejects.toBeInstanceOf(
      DirectoryMismatchError
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'LOGIN_DIRECTORY_MISMATCH',
        details: { bound: 'PRIMARY', found: 'SECONDARY' },
      })
    );
    expect(touchedLockout()).toBe(false);
    expect(db.update.mock.calls.some(([a]) => a?.data?.ldapDirectory)).toBe(false);
  });

  it('direktori tak terjangkau menjadi 503 dan tidak dihitung lockout', async () => {
    const { userService } = await import('../services/user.service.js');
    const { LdapAuthError } = await import('../services/ldap.service.js');
    db.findFirst.mockResolvedValue(existing('PRIMARY'));
    ldap.authenticateAny.mockRejectedValue(
      new LdapAuthError('unavailable', 'LDAP connection failed')
    );

    await expect(userService.loginWithLdap('budi', 'rahasia')).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(touchedLockout()).toBe(false);
  });

  it('password salah tetap dihitung lockout dan pesannya umum', async () => {
    const { userService } = await import('../services/user.service.js');
    const { LdapAuthError } = await import('../services/ldap.service.js');
    db.findFirst.mockResolvedValue(existing('PRIMARY'));
    ldap.authenticateAny.mockRejectedValue(
      new LdapAuthError('invalid_credentials', 'Invalid credentials')
    );

    await expect(userService.loginWithLdap('budi', 'salah')).rejects.toThrow('Invalid credentials');
    expect(touchedLockout()).toBe(true);
  });
});

describe('POST /users/:id/ldap-directory (Pindahkan Direktori)', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const { userRoutes } = await import('../routes/user.routes.js');
    const { errorHandler } = await import('../middleware/errorHandler.js');
    const app = express();
    app.use(express.json());
    app.use('/users', userRoutes);
    app.use(errorHandler);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(() => server?.close());

  const move = (directory: string) =>
    fetch(`http://127.0.0.1:${port}/users/u1/ldap-directory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory }),
    });

  it('mengikat ulang user INTERNAL, mencabut sesi, dan mencatat audit', async () => {
    db.findUnique.mockResolvedValue({ userType: 'INTERNAL', ldapDirectory: 'PRIMARY' });

    const r = await move('SECONDARY');

    expect(r.status).toBe(200);
    expect(db.update.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 'u1' },
      data: { ldapDirectory: 'SECONDARY' },
    });
    expect(issuer.revokeAllUserAccess).toHaveBeenCalledWith('u1');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'LDAP_DIRECTORY_MOVED',
        userId: 'u1',
        details: { from: 'PRIMARY', to: 'SECONDARY', by: 'admin1' },
      })
    );
  });

  it('menolak user non-INTERNAL', async () => {
    db.findUnique.mockResolvedValue({ userType: 'GOVERNMENT', ldapDirectory: null });
    expect((await move('SECONDARY')).status).toBe(409);
    expect(issuer.revokeAllUserAccess).not.toHaveBeenCalled();
  });

  it('menolak bila user sudah di direktori itu', async () => {
    db.findUnique.mockResolvedValue({ userType: 'INTERNAL', ldapDirectory: null });
    expect((await move('PRIMARY')).status).toBe(409);
  });

  it('menolak pindah ke secondary yang belum dikonfigurasi', async () => {
    ldap.isSecondaryConfigured.mockReturnValue(false);
    db.findUnique.mockResolvedValue({ userType: 'INTERNAL', ldapDirectory: 'PRIMARY' });
    expect((await move('SECONDARY')).status).toBe(409);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('nilai direktori di luar daftar ditolak', async () => {
    expect((await move('TERTIARY')).status).toBe(422);
  });

  it('filter daftar user per direktori turun ke query', async () => {
    db.findMany.mockResolvedValue([]);
    db.count.mockResolvedValue(0);
    const r = await fetch(`http://127.0.0.1:${port}/users?directory=SECONDARY`);
    expect(r.status).toBe(200);
    expect(db.findMany.mock.calls[0]?.[0]?.where).toMatchObject({ ldapDirectory: 'SECONDARY' });
  });
});
