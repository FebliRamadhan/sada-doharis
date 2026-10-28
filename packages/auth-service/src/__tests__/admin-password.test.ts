import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sisi admin Masa Berlaku Password: filter status password turun ke query
 * (dan ke hitungan kartu), dan "Wajibkan Ganti Password" hanya menandai user
 * INTERNAL lalu mencabut semua aksesnya — password di Zimbra tidak disentuh.
 */
process.env['DATABASE_URL'] ??= 'postgresql://user:pass@127.0.0.1:5432/test?schema=public';
process.env['JWT_SECRET'] ??= 'test-secret-yang-cukup-panjang-untuk-hs256';
process.env['PASSWORD_EXPIRY_START'] = '2026-01-01T00:00:00Z';

const db = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}));
vi.mock('../config/database.js', () => ({ prisma: { user: db } }));
vi.mock('../middleware/adminGuard.js', () => ({
  adminGuard: (_req: unknown, res: { locals: Record<string, unknown> }, next: () => void) => {
    res.locals['adminUserId'] = 'admin1';
    next();
  },
  isAdminEmail: () => true,
}));
const issuer = vi.hoisted(() => ({ revokeAllUserAccess: vi.fn() }));
vi.mock('../services/login-issuer.service.js', () => issuer);

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

beforeEach(() => {
  db.findMany.mockReset().mockResolvedValue([]);
  db.count.mockReset().mockResolvedValue(0);
  db.findUnique.mockReset().mockResolvedValue({ userType: 'INTERNAL' });
  db.update.mockReset().mockResolvedValue({
    id: 'u1',
    email: 'budi@menpan.go.id',
    userType: 'INTERNAL',
    passwordChangedAt: null,
    passwordMustChange: true,
  });
  issuer.revokeAllUserAccess.mockReset().mockResolvedValue(undefined);
});

const whereDaftar = () => db.findMany.mock.calls[0]?.[0]?.where;

describe('GET /users?password=…', () => {
  it('filter kedaluwarsa turun ke query dan ke hitungan', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/users?password=expired&type=INTERNAL`);
    expect(r.status).toBe(200);
    expect(whereDaftar()).toMatchObject({
      userType: 'INTERNAL',
      AND: [{ userType: 'INTERNAL', OR: expect.arrayContaining([{ passwordMustChange: true }]) }],
    });
    expect(db.count.mock.calls[0]?.[0]?.where).toEqual(whereDaftar());
  });

  it('nilai di luar daftar ditolak', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/users?password=kadang`);
    expect(r.status).toBe(422);
  });

  it('setiap baris membawa status masa berlaku password', async () => {
    db.findMany.mockResolvedValue([
      { id: 'u1', userType: 'INTERNAL', passwordChangedAt: null, passwordMustChange: true },
    ]);
    const r = await fetch(`http://127.0.0.1:${port}/users`);
    const body = (await r.json()) as { data: { passwordExpiry: { status: string } }[] };
    expect(body.data[0]?.passwordExpiry.status).toBe('expired');
  });
});

describe('POST /users/:id/password/require-change', () => {
  const wajibkan = () =>
    fetch(`http://127.0.0.1:${port}/users/u1/password/require-change`, { method: 'POST' });

  it('menandai user lalu mencabut semua aksesnya', async () => {
    const r = await wajibkan();
    expect(r.status).toBe(200);
    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { passwordMustChange: true } })
    );
    expect(issuer.revokeAllUserAccess).toHaveBeenCalledWith('u1');
  });

  it('menolak user non-INTERNAL tanpa mengubah apa pun', async () => {
    db.findUnique.mockResolvedValue({ userType: 'GOVERNMENT' });
    const r = await wajibkan();
    expect(r.status).toBe(409);
    expect(db.update).not.toHaveBeenCalled();
    expect(issuer.revokeAllUserAccess).not.toHaveBeenCalled();
  });

  it('user tidak ada → 404', async () => {
    db.findUnique.mockResolvedValue(null);
    expect((await wajibkan()).status).toBe(404);
  });
});
