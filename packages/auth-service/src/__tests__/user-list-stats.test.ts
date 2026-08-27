import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Kartu statistik di halaman admin dulu menjumlahkan baris yang kebetulan
 * sedang dipegang satu halaman, lalu menyebutnya total sistem. Dengan limit 20,
 * sebuah instansi berisi 354 pengguna melaporkan "Aktif: 20".
 *
 * Perbaikannya menaruh hitungan di database. Yang dikunci di sini adalah dua
 * sifat yang membuat hitungan itu benar: ia tidak boleh berasal dari halaman,
 * dan ia harus tunduk pada filter pencarian yang sama dengan daftarnya —
 * angka yang mengabaikan filter akan berkontradiksi dengan tabel di bawahnya.
 */
process.env['DATABASE_URL'] ??= 'postgresql://user:pass@127.0.0.1:5432/test?schema=public';

const db = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
}));

vi.mock('../config/database.js', () => ({
  prisma: { user: db },
}));

const { userService } = await import('../services/user.service.js');

/** Satu halaman berisi 3 baris, semuanya aktif — sengaja tidak mewakili keseluruhan. */
const halaman = [
  { id: 'a', email: 'a@x', name: 'A', isActive: true },
  { id: 'b', email: 'b@x', name: 'B', isActive: true },
  { id: 'c', email: 'c@x', name: 'C', isActive: true },
];

beforeEach(() => {
  db.findMany.mockReset().mockResolvedValue(halaman);
  // count dipanggil dua kali: total, lalu yang aktif.
  db.count.mockReset().mockResolvedValueOnce(354).mockResolvedValueOnce(300);
});

describe('userService.list — hitungan menyeluruh', () => {
  it('melaporkan hitungan dari database, bukan dari isi halaman', async () => {
    const { users, meta } = await userService.list({ page: 1, limit: 3 });

    expect(users).toHaveLength(3);
    expect(meta.total).toBe(354);
    expect(meta.activeCount).toBe(300);
    // Kalau ini pernah menyamai jumlah baris halaman, bug lamanya kembali.
    expect(meta.activeCount).not.toBe(users.length);
  });

  it('nonaktif diturunkan dari total, bukan dari halaman', async () => {
    const { meta } = await userService.list({ page: 1, limit: 3 });
    expect(meta.inactiveCount).toBe(54);
    expect(meta.activeCount + meta.inactiveCount).toBe(meta.total);
  });

  it('hitungan aktif memakai filter pencarian yang sama dengan daftarnya', async () => {
    await userService.list({ page: 1, limit: 3, search: 'budi' });

    const whereDaftar = db.findMany.mock.calls[0]?.[0]?.where;
    const whereTotal = db.count.mock.calls[0]?.[0]?.where;
    const whereAktif = db.count.mock.calls[1]?.[0]?.where;

    expect(whereTotal).toEqual(whereDaftar);
    // Sama persis, hanya ditambah syarat aktif.
    expect(whereAktif).toEqual({ ...whereDaftar, isActive: true });
    expect(JSON.stringify(whereAktif)).toContain('budi');
  });

  it('tanpa pencarian, hitungan mencakup seluruh tabel', async () => {
    await userService.list({ page: 1, limit: 3 });
    expect(db.count.mock.calls[0]?.[0]?.where).toEqual({});
    expect(db.count.mock.calls[1]?.[0]?.where).toEqual({ isActive: true });
  });
});
