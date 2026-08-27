import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Regresi dari insiden produksi 2026-08-27.
 *
 * `adminGuard` adalah fungsi async, dan `verifyToken` melempar untuk token yang
 * kedaluwarsa maupun cacat. Express 4 tidak menunggu promise middleware,
 * sehingga lemparan itu menjadi unhandled rejection — dan Node 22 mematikan
 * proses. Karena nginx mem-proxy /api/ langsung ke auth-service tanpa melewati
 * gateway, satu permintaan dari internet dengan header Bearer sembarang cukup
 * untuk memadamkan SSO bagi seluruh pengguna. Di hari itu auth-service restart
 * tujuh kali, dan tiap restart menjawab permintaan yang sedang berjalan dengan
 * 502.
 *
 * Tes ini menahan dua hal sekaligus: jawabannya harus 401, dan prosesnya harus
 * tetap hidup. Yang kedua diuji dengan memantau `unhandledRejection` — kalau
 * penanganannya kembali bocor, listener itu menyala dan tesnya gagal, alih-alih
 * mematikan proses vitest secara misterius.
 */
process.env['DATABASE_URL'] ??= 'postgresql://user:pass@127.0.0.1:5432/test?schema=public';
process.env['JWT_SECRET'] ??= 'test-secret-yang-cukup-panjang-untuk-hs256';
process.env['ADMIN_EMAILS'] ??= 'admin@menpan.go.id';

const db = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('../config/database.js', () => ({ prisma: { user: db } }));

let server: Server;
let port: number;
const rejections: unknown[] = [];

function catatRejection(reason: unknown): void {
  rejections.push(reason);
}

beforeAll(async () => {
  process.on('unhandledRejection', catatRejection);

  const { adminGuard } = await import('../middleware/adminGuard.js');
  const { errorHandler } = await import('../middleware/errorHandler.js');

  const app = express();
  app.get('/users', adminGuard, (_req, res) => {
    res.json({ success: true, data: [] });
  });
  app.use(errorHandler);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve();
    });
  });
});

afterAll(() => {
  process.off('unhandledRejection', catatRejection);
  server?.close();
});

async function panggil(authorization?: string): Promise<number> {
  const r = await fetch(`http://127.0.0.1:${port}/users`, {
    headers: authorization ? { Authorization: authorization } : {},
  });
  return r.status;
}

/**
 * Token ditandatangani dengan kunci RS256 milik service itu sendiri — sama
 * seperti token sungguhan. Menandatangani dengan HS256/JWT_SECRET hanya akan
 * menghasilkan 401 karena tanda tangannya salah, sehingga jalur yang justru
 * ingin diuji (token sah, dan token sah tapi kedaluwarsa) tidak pernah tercapai.
 */
async function tandatangani(payload: Record<string, unknown>): Promise<string> {
  const { default: jwt } = await import('jsonwebtoken');
  const { getPrivateKey, getKeyId } = await import('../config/keys.js');
  return jwt.sign(
    payload,
    getPrivateKey().export({ type: 'pkcs8', format: 'pem' }) as string,
    {
      algorithm: 'RS256',
      header: { alg: 'RS256', kid: getKeyId() },
    } as never
  );
}

/** Memberi kesempatan rejection yang tak tertangani muncul sebelum diperiksa. */
async function tungguMikrotask(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

describe('adminGuard — token tidak sah dijawab, bukan mematikan proses', () => {
  it('token kedaluwarsa dijawab 401', async () => {
    const kedaluwarsa = await tandatangani({
      sub: 'u1',
      type: 'user',
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    expect(await panggil(`Bearer ${kedaluwarsa}`)).toBe(401);
  });

  it('token sampah dijawab 401 — inilah bentuk serangan termurahnya', async () => {
    expect(await panggil('Bearer x')).toBe(401);
  });

  it('tanda tangan salah dijawab 401', async () => {
    const { default: jwt } = await import('jsonwebtoken');
    const palsu = jwt.sign({ sub: 'u1', type: 'user' }, 'kunci-yang-salah-sama-sekali');
    expect(await panggil(`Bearer ${palsu}`)).toBe(401);
  });

  it('tanpa header Authorization dijawab 401', async () => {
    expect(await panggil()).toBe(401);
  });

  it('tidak ada satu pun unhandled rejection yang lolos', async () => {
    await panggil('Bearer x');
    await panggil('Bearer masih.bukan.jwt');
    await tungguMikrotask();
    // Di kode lama, setiap panggilan di atas mematikan proses produksi.
    expect(rejections).toEqual([]);
  });

  it('permintaan sah tetap diteruskan', async () => {
    db.findUnique.mockResolvedValue({ email: 'admin@menpan.go.id' });
    const sah = await tandatangani({
      sub: 'u1',
      type: 'user',
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    expect(await panggil(`Bearer ${sah}`)).toBe(200);
  });

  it('bukan admin dijawab 403, bukan 401', async () => {
    db.findUnique.mockResolvedValue({ email: 'orang.biasa@menpan.go.id' });
    const sah = await tandatangani({
      sub: 'u2',
      type: 'user',
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    expect(await panggil(`Bearer ${sah}`)).toBe(403);
  });

  it('kegagalan database jadi 500 lewat error handler, bukan rejection liar', async () => {
    db.findUnique.mockRejectedValue(new Error('database tidak terjangkau'));
    const sah = await tandatangani({
      sub: 'u3',
      type: 'user',
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    const status = await panggil(`Bearer ${sah}`);
    await tungguMikrotask();
    expect(status).toBe(500);
    expect(rejections).toEqual([]);
  });
});
