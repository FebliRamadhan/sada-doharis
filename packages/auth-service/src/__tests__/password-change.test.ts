import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Ganti Password LDAP (docs/adr/0002). Yang dikunci di sini:
 *  - password diganti lewat Zimbra dengan password lama milik user sendiri,
 *  - syarat SADA ditegakkan SEBELUM Zimbra dihubungi,
 *  - keberhasilan mencabut semua akses lama lalu menerbitkan login baru,
 *  - tebakan password lama dibatasi,
 *  - gerbang login menyerahkan tiket, bukan token, saat password kedaluwarsa.
 */
process.env['DATABASE_URL'] ??= 'postgresql://user:pass@127.0.0.1:5432/test?schema=public';
process.env['JWT_SECRET'] ??= 'test-secret-yang-cukup-panjang-untuk-hs256';
process.env['PASSWORD_EXPIRY_START'] = '2026-01-01T00:00:00Z';

const db = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }));
vi.mock('../config/database.js', () => ({ prisma: { user: db } }));

const store = vi.hoisted(() => new Map<string, string>());
vi.mock('../config/redis.js', () => ({
  getRedis: () => ({
    get: async (k: string) => store.get(k) ?? null,
    setex: async (k: string, _ttl: number, v: string) => void store.set(k, v),
    del: async (...keys: string[]) => keys.forEach((k) => store.delete(k)),
    incr: async (k: string) => {
      const n = parseInt(store.get(k) ?? '0', 10) + 1;
      store.set(k, String(n));
      return n;
    },
    expire: async () => 1,
  }),
}));

const zimbra = vi.hoisted(() => ({ changePassword: vi.fn() }));
vi.mock('../services/zimbra.service.js', () => ({ zimbraService: zimbra }));

const sesi = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('../services/session.service.js', () => ({
  sessionService: { getUserId: vi.fn(async () => sesi.userId), create: vi.fn(), destroy: vi.fn() },
}));

const issuer = vi.hoisted(() => ({ issueUserLogin: vi.fn(), revokeAllUserAccess: vi.fn() }));
vi.mock('../services/login-issuer.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/login-issuer.service.js')>()),
  ...issuer,
}));

const BUDI = {
  id: 'u1',
  email: 'budi.santoso@menpan.go.id',
  name: 'Budi Santoso',
  userType: 'INTERNAL',
  isActive: true,
  passwordChangedAt: null,
  passwordMustChange: true,
};
const PW_BARU = 'Kopi-Pagi#Rabu42';

let server: Server;
let port: number;

async function kirim(
  path: string,
  body: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

beforeAll(async () => {
  const { passwordRoutes } = await import('../routes/password.routes.js');
  const { errorHandler } = await import('../middleware/errorHandler.js');
  const app = express();
  app.use(express.json());
  app.use('/', passwordRoutes);
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

beforeEach(() => {
  store.clear();
  store.set('pwd_change:T1', JSON.stringify({ userId: 'u1', scopes: ['profile', 'email'] }));
  sesi.userId = null;
  db.findUnique.mockReset().mockResolvedValue({ ...BUDI });
  db.update.mockReset().mockResolvedValue({});
  zimbra.changePassword.mockReset().mockResolvedValue(undefined);
  issuer.issueUserLogin.mockReset().mockResolvedValue({ access_token: 'baru' });
  issuer.revokeAllUserAccess.mockReset().mockResolvedValue(undefined);
});

describe('POST /auth/password/change-expired', () => {
  const ganti = (body: Record<string, unknown> = {}) =>
    kirim('/auth/password/change-expired', {
      ticket: 'T1',
      old_password: 'Lama#Sekali2025',
      new_password: PW_BARU,
      ...body,
    });

  it('tiket kedaluwarsa berarti login ulang', async () => {
    const { status } = await ganti({ ticket: 'tidak-ada' });
    expect(status).toBe(401);
    expect(zimbra.changePassword).not.toHaveBeenCalled();
  });

  it('syarat SADA ditegakkan sebelum Zimbra dihubungi', async () => {
    const { status, body } = await ganti({ new_password: 'pendek' });
    expect(status).toBe(422);
    expect(JSON.stringify(body)).toContain('Minimal 12');
    expect(zimbra.changePassword).not.toHaveBeenCalled();
  });

  it('berhasil: ganti di Zimbra sebagai user, catat tanggal, cabut akses lama, lanjut login', async () => {
    const { status, body } = await ganti();
    expect(status).toBe(200);
    expect(zimbra.changePassword).toHaveBeenCalledWith(BUDI.email, 'Lama#Sekali2025', PW_BARU);
    expect(db.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { passwordChangedAt: expect.any(Date), passwordMustChange: false },
    });
    expect(issuer.revokeAllUserAccess).toHaveBeenCalledWith('u1');
    expect(issuer.issueUserLogin).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', scopes: ['profile', 'email'] })
    );
    expect(issuer.revokeAllUserAccess.mock.invocationCallOrder[0]).toBeLessThan(
      issuer.issueUserLogin.mock.invocationCallOrder[0]!
    );
    expect((body['data'] as Record<string, unknown>)['access_token']).toBe('baru');
    expect(store.has('pwd_change:T1')).toBe(false);
  });

  it('penolakan Zimbra diteruskan dan tiket tetap bisa dipakai ulang', async () => {
    const { ValidationError } = await import('@sada/shared');
    zimbra.changePassword.mockRejectedValueOnce(
      new ValidationError('Password ini sudah pernah Anda pakai.', { new_password: ['x'] })
    );
    const { status } = await ganti();
    expect(status).toBe(422);
    expect(issuer.revokeAllUserAccess).not.toHaveBeenCalled();
    expect(store.has('pwd_change:T1')).toBe(true);
  });

  it('password lama salah 5 kali mengunci percobaan berikutnya tanpa menghubungi Zimbra', async () => {
    const { ValidationError } = await import('@sada/shared');
    zimbra.changePassword.mockRejectedValue(
      new ValidationError('Password lama salah.', { old_password: ['Password lama salah.'] })
    );
    for (let i = 0; i < 5; i++) expect((await ganti()).status).toBe(422);
    zimbra.changePassword.mockClear();
    expect((await ganti()).status).toBe(429);
    expect(zimbra.changePassword).not.toHaveBeenCalled();
  });

  it('hanya untuk akun INTERNAL', async () => {
    db.findUnique.mockResolvedValue({ ...BUDI, userType: 'GOVERNMENT' });
    expect((await ganti()).status).toBe(403);
    expect(zimbra.changePassword).not.toHaveBeenCalled();
  });
});

describe('POST /auth/password/change (sukarela)', () => {
  const ganti = () =>
    kirim('/auth/password/change', { old_password: 'Lama#Sekali2025', new_password: PW_BARU });

  it('butuh login', async () => {
    expect((await ganti()).status).toBe(401);
  });

  it('user yang login bisa ganti kapan saja, dengan akibat yang sama', async () => {
    sesi.userId = 'u1';
    db.findUnique.mockResolvedValue({ ...BUDI, passwordMustChange: false });
    expect((await ganti()).status).toBe(200);
    expect(issuer.revokeAllUserAccess).toHaveBeenCalledWith('u1');
    expect(issuer.issueUserLogin).toHaveBeenCalled();
  });
});

describe('maybeRequirePasswordChange (gerbang setelah MFA)', () => {
  function fakeRes() {
    const sent: unknown[] = [];
    const res = {
      status: () => res,
      json: (b: unknown) => {
        sent.push(b);
        return res;
      },
    };
    return { res: res as unknown as import('express').Response, sent };
  }

  it('password masih berlaku: tidak menghalangi', async () => {
    const { maybeRequirePasswordChange } = await import('../services/login-issuer.service.js');
    const { res, sent } = fakeRes();
    const blocked = await maybeRequirePasswordChange(
      res,
      { ...BUDI, passwordMustChange: false, passwordChangedAt: new Date() },
      ['profile']
    );
    expect(blocked).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('kedaluwarsa: mengirim tiket (dan kode cadangan bila ada), bukan token', async () => {
    const { maybeRequirePasswordChange } = await import('../services/login-issuer.service.js');
    const { res, sent } = fakeRes();
    const blocked = await maybeRequirePasswordChange(res, BUDI, ['profile'], {
      backup_codes: ['a'],
    });
    expect(blocked).toBe(true);
    const data = (sent[0] as { data: Record<string, unknown> }).data;
    expect(data['password_change_required']).toBe(true);
    expect(data['backup_codes']).toEqual(['a']);
    expect(data['access_token']).toBeUndefined();
    expect(store.get(`pwd_change:${data['password_ticket'] as string}`)).toContain('"u1"');
  });
});
