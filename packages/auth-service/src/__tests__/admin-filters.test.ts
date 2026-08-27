import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Penyaringan di halaman admin harus terjadi di database, dan hitungan di
 * kartu statistik harus tunduk pada filter yang sama dengan daftarnya.
 *
 * Dua sifat itu saling mengunci. Kalau penyaringan pindah ke browser, ia hanya
 * menyaring satu halaman. Kalau hitungan mengabaikan filter, angka di kartu
 * akan berkontradiksi dengan tabel tepat di bawahnya. Keduanya diuji di sini
 * lewat `where` yang benar-benar dikirim ke Prisma.
 */
process.env['DATABASE_URL'] ??= 'postgresql://user:pass@127.0.0.1:5432/test?schema=public';

const db = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }));
vi.mock('../config/database.js', () => ({ prisma: { user: db } }));

const { userService } = await import('../services/user.service.js');

beforeEach(() => {
  db.findMany.mockReset().mockResolvedValue([]);
  db.count.mockReset().mockResolvedValue(0);
});

const whereDaftar = () => db.findMany.mock.calls[0]?.[0]?.where;
const whereTotal = () => db.count.mock.calls[0]?.[0]?.where;
const whereTurunan = () => db.count.mock.calls[1]?.[0]?.where;

describe('userService.list — filter diterjemahkan ke query', () => {
  it('tanpa filter, tidak ada syarat yang ditambahkan', async () => {
    await userService.list({ page: 1, limit: 20 });
    expect(whereDaftar()).toEqual({});
  });

  it('status aktif', async () => {
    await userService.list({ page: 1, limit: 20, isActive: true });
    expect(whereDaftar()).toEqual({ isActive: true });
  });

  it('status nonaktif — false tidak boleh dianggap "tidak diisi"', async () => {
    // `if (opts.isActive)` akan menelan nilai false dan diam-diam menampilkan
    // seluruh pengguna. Karena itu jalur ini diuji terpisah.
    await userService.list({ page: 1, limit: 20, isActive: false });
    expect(whereDaftar()).toEqual({ isActive: false });
  });

  it('belum enroll MFA — false juga tidak boleh tertelan', async () => {
    await userService.list({ page: 1, limit: 20, mfaEnabled: false });
    expect(whereDaftar()).toEqual({ mfaEnabled: false });
  });

  it('tipe pengguna', async () => {
    await userService.list({ page: 1, limit: 20, userType: 'INTERNAL' as never });
    expect(whereDaftar()).toEqual({ userType: 'INTERNAL' });
  });

  it('filter bertumpuk digabung, bukan saling menimpa', async () => {
    await userService.list({
      page: 1,
      limit: 20,
      search: 'budi',
      isActive: true,
      userType: 'INTERNAL' as never,
      mfaEnabled: false,
    });

    const w = whereDaftar();
    expect(w.isActive).toBe(true);
    expect(w.userType).toBe('INTERNAL');
    expect(w.mfaEnabled).toBe(false);
    expect(JSON.stringify(w.OR)).toContain('budi');
  });
});

describe('userService.list — hitungan mengikuti filter', () => {
  it('total dihitung atas filter yang sama dengan daftarnya', async () => {
    await userService.list({ page: 1, limit: 20, userType: 'INTERNAL' as never });
    expect(whereTotal()).toEqual(whereDaftar());
  });

  it('hitungan aktif hanya menambah syarat isActive di atas filter yang sama', async () => {
    await userService.list({ page: 1, limit: 20, search: 'budi', mfaEnabled: false });
    expect(whereTurunan()).toEqual({ ...whereDaftar(), isActive: true });
  });

  it('hitungan tidak pernah diambil dari baris yang dikembalikan', async () => {
    // Halaman berisi 3 baris, database melaporkan 354/300. Kalau salah satu
    // angka pernah menyamai 3, hitungannya kembali bersumber dari halaman.
    db.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    db.count.mockReset().mockResolvedValueOnce(354).mockResolvedValueOnce(300);

    const { users, meta } = await userService.list({ page: 1, limit: 3 });

    expect(users).toHaveLength(3);
    expect(meta.total).toBe(354);
    expect(meta.activeCount).toBe(300);
    expect(meta.inactiveCount).toBe(54);
  });
});
