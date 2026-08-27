import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Pendaftaran mandiri (`POST /auth/register`) menerbitkan sesi penuh tanpa
 * verifikasi email maupun persetujuan admin, dan akun yang lahir darinya tetap
 * bisa menyelesaikan OAuth flow ke seluruh client terdaftar. Karena itu pintunya
 * ditutup dan hanya boleh dibuka lewat REGISTRATION_ENABLED=true yang eksplisit.
 *
 * Yang dikunci di sini adalah sifat *fail closed*-nya: env yang kosong, salah
 * huruf, atau diisi nilai "kira-kira benar" ('1', 'yes', 'TRUE') harus tetap
 * dianggap tertutup. Sekali ada yang melonggarkan pembacaan itu jadi truthy,
 * satu deployment dengan env setengah benar akan membuka kembali pendaftaran
 * publik tanpa ada yang menyadarinya.
 *
 * Memakai server sungguhan + fetch, mengikuti pola discovery-proto.test.ts,
 * supaya tidak menambah dependensi tes baru. Tidak ada database yang disentuh:
 * penolakan 404 terjadi sebelum handler menyentuh Prisma, dan jalur "terbuka"
 * diuji lewat kegagalan validasi yang juga mendahului query.
 */

// Prisma client dibuat saat modul di-import; cukup ada URL-nya, tidak dikoneksikan.
process.env['DATABASE_URL'] ??= 'postgresql://user:pass@127.0.0.1:5432/test?schema=public';
process.env['JWT_SECRET'] ??= 'test-secret-yang-cukup-panjang-untuk-hs256';
process.env['SESSION_COOKIE_SECRET'] ??= 'test-session-secret-yang-cukup-panjang';

let server: Server;
let port: number;

async function panggil(
  path: string,
  init?: RequestInit
): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, init);
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: r.status, body };
}

/**
 * Body sengaja kosong. Gerbang REGISTRATION_ENABLED berjalan SEBELUM validasi,
 * jadi: tertutup → 404, terbuka → 422 (berhenti di validasi). Dengan begitu
 * jalur "terbuka" pun tidak pernah menyentuh database.
 */
const daftar = (): Promise<{ status: number; body: Record<string, unknown> }> =>
  panggil('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

const konfigurasi = async (): Promise<boolean> => {
  const { body } = await panggil('/auth/config');
  return (body['data'] as { registration_enabled?: boolean })?.registration_enabled === true;
};

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

afterAll(() => {
  server?.close();
  delete process.env['REGISTRATION_ENABLED'];
});

describe('kill-switch pendaftaran mandiri', () => {
  it('tertutup saat env tidak diisi sama sekali', async () => {
    delete process.env['REGISTRATION_ENABLED'];
    expect((await daftar()).status).toBe(404);
  });

  it('tertutup saat env bernilai false', async () => {
    process.env['REGISTRATION_ENABLED'] = 'false';
    expect((await daftar()).status).toBe(404);
  });

  it.each(['TRUE', 'True', '1', 'yes', 'on', ' true', ''])(
    'tetap tertutup untuk nilai env yang tidak persis "true": %j',
    async (nilai) => {
      process.env['REGISTRATION_ENABLED'] = nilai;
      expect((await daftar()).status).toBe(404);
    }
  );

  it('membalas 404, bukan 403 — tidak mengumumkan bahwa fiturnya ada tapi dikunci', async () => {
    process.env['REGISTRATION_ENABLED'] = 'false';
    const { status, body } = await daftar();
    expect(status).toBe(404);
    expect(JSON.stringify(body).toLowerCase()).not.toContain('disabled');
  });

  it('terbuka saat env persis "true": permintaan diteruskan ke validasi, bukan ditolak 404', async () => {
    process.env['REGISTRATION_ENABLED'] = 'true';
    // 422 = ValidationError milik repo ini; yang penting ia bukan 404.
    expect((await daftar()).status).toBe(422);
  });
});

describe('GET /auth/config sebagai sumber kebenaran bagi auth-ui', () => {
  it('melaporkan tertutup saat env tidak diisi', async () => {
    delete process.env['REGISTRATION_ENABLED'];
    expect(await konfigurasi()).toBe(false);
  });

  it('melaporkan terbuka saat env persis "true"', async () => {
    process.env['REGISTRATION_ENABLED'] = 'true';
    expect(await konfigurasi()).toBe(true);
  });

  it('mengikuti perubahan env tanpa perlu restart proses', async () => {
    process.env['REGISTRATION_ENABLED'] = 'true';
    expect(await konfigurasi()).toBe(true);
    process.env['REGISTRATION_ENABLED'] = 'false';
    expect(await konfigurasi()).toBe(false);
  });

  it('laporan config selalu sejalan dengan perilaku endpoint register', async () => {
    for (const nilai of ['true', 'false', 'TRUE']) {
      process.env['REGISTRATION_ENABLED'] = nilai;
      const terbuka = await konfigurasi();
      const status = (await daftar()).status;
      expect(terbuka).toBe(status !== 404);
    }
  });

  it('tidak membocorkan apa pun selain flag', async () => {
    process.env['REGISTRATION_ENABLED'] = 'true';
    const { body } = await panggil('/auth/config');
    expect(Object.keys(body['data'] as object)).toEqual(['registration_enabled']);
  });
});
