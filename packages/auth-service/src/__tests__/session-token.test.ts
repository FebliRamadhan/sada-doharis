import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Access token hidup 15 menit, sesi SSO hidup berhari-hari. Tanpa jalur
 * penukaran ini, setiap halaman yang butuh Bearer akan mati empat kali sejam
 * padahal penggunanya masih login — itulah keluhan "halaman admin, sesi habis,
 * tidak redirect" yang jadi asal perbaikan ini.
 *
 * Yang dikunci di sini adalah batas kewenangannya. Endpoint ini menerbitkan
 * kredensial hanya berbekal cookie, jadi ia harus menolak setiap keadaan di
 * mana cookie itu tidak lagi mewakili orang yang berhak: sesi hilang, akun
 * terhapus, atau akun dinonaktifkan. Dan penolakannya harus seragam — pesan
 * yang berbeda-beda akan memberi tahu penyerang mana dari ketiganya yang kena.
 */
process.env['DATABASE_URL'] ??= 'postgresql://user:pass@127.0.0.1:5432/test?schema=public';
process.env['JWT_SECRET'] ??= 'test-secret-yang-cukup-panjang-untuk-hs256';
process.env['SESSION_COOKIE_SECRET'] ??= 'test-session-secret-yang-cukup-panjang';

const sesi = vi.hoisted(() => ({ userId: null as string | null }));
const akun = vi.hoisted(() => ({
  value: null as { id: string; email: string; name: string; isActive: boolean } | null,
}));

vi.mock('../services/session.service.js', () => ({
  sessionService: {
    getUserId: vi.fn(async () => sesi.userId),
    create: vi.fn(),
    destroy: vi.fn(),
  },
  SESSION_COOKIE_NAME: 'sada_sid',
}));

vi.mock('../services/user.service.js', () => ({
  userService: {
    findById: vi.fn(async () => {
      if (!akun.value) throw new Error('User not found');
      return akun.value;
    }),
  },
}));

let server: Server;
let port: number;

async function tukar(): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(`http://127.0.0.1:${port}/auth/session/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: r.status, body };
}

beforeAll(async () => {
  const { authRoutes } = await import('../routes/auth.routes.js');
  const { errorHandler } = await import('../middleware/errorHandler.js');

  const app = express();
  app.use(express.json());
  app.use('/auth', authRoutes);
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
  sesi.userId = 'u1';
  akun.value = { id: 'u1', email: 'admin@menpan.go.id', name: 'Admin', isActive: true };
});

describe('POST /auth/session/token', () => {
  it('menerbitkan access token saat sesi masih sah', async () => {
    const { status, body } = await tukar();
    expect(status).toBe(200);
    const data = body['data'] as Record<string, unknown>;
    expect(typeof data['access_token']).toBe('string');
    expect(data['token_type']).toBe('Bearer');
    expect(Number(data['expires_in'])).toBeGreaterThan(0);
  });

  it('token yang diterbitkan sah dan menunjuk pemilik sesi', async () => {
    const { body } = await tukar();
    const token = (body['data'] as { access_token: string }).access_token;
    const { tokenService } = await import('../services/token.service.js');
    const payload = tokenService.verifyToken(token);
    expect(payload.sub).toBe('u1');
  });

  it('scope-nya tidak melebihi login biasa', async () => {
    const { body } = await tukar();
    const token = (body['data'] as { access_token: string }).access_token;
    const { tokenService } = await import('../services/token.service.js');
    // Pembaruan tidak boleh jadi jalan pintas menaikkan hak: penukaran cookie
    // hanya memulihkan yang sudah dimiliki, bukan menambah.
    expect(tokenService.verifyToken(token).scopes).toEqual(['profile', 'email']);
  });

  it('menolak saat tidak ada sesi', async () => {
    sesi.userId = null;
    expect((await tukar()).status).toBe(401);
  });

  it('menolak saat akun sudah terhapus', async () => {
    akun.value = null;
    expect((await tukar()).status).toBe(401);
  });

  it('menolak saat akun dinonaktifkan', async () => {
    // Sesi bisa lebih tua daripada penonaktifan akun. Kalau ini lolos, admin
    // yang menonaktifkan seseorang tidak benar-benar memutus aksesnya.
    akun.value = { id: 'u1', email: 'x@y.z', name: 'X', isActive: false };
    expect((await tukar()).status).toBe(401);
  });

  it('alasan penolakan tidak dibedakan antar penyebab', async () => {
    sesi.userId = null;
    const tanpaSesi = await tukar();

    sesi.userId = 'u1';
    akun.value = null;
    const akunHilang = await tukar();

    akun.value = { id: 'u1', email: 'x@y.z', name: 'X', isActive: false };
    const akunMati = await tukar();

    expect(tanpaSesi.body).toEqual(akunHilang.body);
    expect(akunHilang.body).toEqual(akunMati.body);
  });
});
