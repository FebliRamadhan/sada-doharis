import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Daftar MFA di halaman admin adalah alat kerja: sejak MFA diwajibkan, yang
 * dicari admin adalah siapa saja yang BELUM enroll. Dengan 354 pengguna
 * internal dan limit 20, tanpa filter dan tanpa pencarian jawabannya hanya bisa
 * didapat dengan memindai belasan halaman.
 *
 * Yang dikunci di sini: penyaringan benar-benar turun ke query, hitungan kartu
 * tunduk pada filter yang sama, dan — yang paling penting — syarat INTERNAL
 * tidak pernah bisa dilonggarkan oleh parameter dari klien. MFA hanya berlaku
 * bagi INTERNAL; membocorkan tipe lain ke daftar ini akan salah menyiratkan
 * bahwa mereka pun punya faktor kedua.
 */
process.env['DATABASE_URL'] ??= 'postgresql://user:pass@127.0.0.1:5432/test?schema=public';
process.env['JWT_SECRET'] ??= 'test-secret-yang-cukup-panjang-untuk-hs256';

const db = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn(), update: vi.fn() }));
vi.mock('../config/database.js', () => ({ prisma: { user: db } }));
vi.mock('../middleware/adminGuard.js', () => ({
  adminGuard: (_req: unknown, _res: unknown, next: () => void) => next(),
  isAdminEmail: () => true,
}));

let server: Server;
let port: number;

async function ambil(qs: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(`http://127.0.0.1:${port}/admin/mfa/users${qs}`);
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: r.status, body };
}

const whereDaftar = () => db.findMany.mock.calls[0]?.[0]?.where;
const whereEnabled = () => db.count.mock.calls[1]?.[0]?.where;

beforeAll(async () => {
  const { mfaRoutes } = await import('../routes/mfa.routes.js');
  const { errorHandler } = await import('../middleware/errorHandler.js');

  const app = express();
  app.use(express.json());
  app.use('/', mfaRoutes);
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
  db.count.mockReset().mockResolvedValueOnce(354).mockResolvedValueOnce(108);
});

describe('GET /admin/mfa/users', () => {
  it('melaporkan hitungan menyeluruh, bukan isi halaman', async () => {
    const { status, body } = await ambil('?page=1&limit=20');
    expect(status).toBe(200);
    const data = body['data'] as Record<string, number>;
    expect(data['total']).toBe(354);
    expect(data['enabledCount']).toBe(108);
    expect(data['pendingCount']).toBe(246);
  });

  it('hanya memuat pengguna internal', async () => {
    await ambil('');
    expect(whereDaftar().userType).toBe('INTERNAL');
  });

  it('filter "belum enroll" turun ke query sebagai mfaEnabled: false', async () => {
    await ambil('?mfa=pending');
    expect(whereDaftar()).toMatchObject({ userType: 'INTERNAL', mfaEnabled: false });
  });

  it('filter "sudah enroll" turun ke query sebagai mfaEnabled: true', async () => {
    await ambil('?mfa=enabled');
    expect(whereDaftar()).toMatchObject({ userType: 'INTERNAL', mfaEnabled: true });
  });

  it('pencarian menjadi syarat OR di database, bukan saringan di browser', async () => {
    await ambil('?search=budi');
    expect(JSON.stringify(whereDaftar().OR)).toContain('budi');
  });

  it('hitungan enrolled memakai filter yang sama, hanya ditambah syarat mfaEnabled', async () => {
    await ambil('?search=budi&mfa=pending');
    expect(whereEnabled()).toEqual({ ...whereDaftar(), mfaEnabled: true });
  });

  it('syarat INTERNAL tidak bisa ditumpangi parameter dari klien', async () => {
    // Percobaan menyuntik userType lewat query string harus diabaikan total.
    await ambil('?userType=EXTERNAL&type=EXTERNAL&where=%7B%7D');
    expect(whereDaftar().userType).toBe('INTERNAL');
  });

  it('nilai filter di luar daftar ditolak, bukan diabaikan diam-diam', async () => {
    // Diabaikan berarti menampilkan seluruh pengguna padahal admin mengira
    // sedang melihat hasil tersaring — kesalahan yang tidak terlihat di layar.
    const { status } = await ambil('?mfa=kadang');
    expect(status).toBe(422);
  });
});
