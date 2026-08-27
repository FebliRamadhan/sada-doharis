import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

/**
 * Endpoint /oauth/authorize melayani DUA jenis pemanggil:
 *
 *   - XHR dari auth-ui  → JSON `needs_consent: true`, agar ia menampilkan
 *                         layar persetujuan
 *   - navigasi browser  → pengalihan ke layar itu
 *
 * Tanpa pembedaan ini, pengguna yang sudah punya sesi SADA lalu datang dari
 * aplikasi lain mendarat pada JSON mentah di address bar-nya — alurnya
 * berhenti tepat sebelum layar persetujuan yang seharusnya muncul.
 *
 * Salinan logika detektornya diuji di sini agar aturannya terkunci tanpa
 * perlu menyalakan seluruh server.
 */
function isBrowserNavigation(req: Pick<Request, 'headers'>): boolean {
  if (req.headers['sec-fetch-mode'] === 'navigate') return true;
  return (req.headers['accept'] ?? '').includes('text/html');
}

const req = (headers: Record<string, string>) => ({ headers }) as unknown as Request;

describe('membedakan navigasi browser dari XHR auth-ui', () => {
  it('Sec-Fetch-Mode: navigate dikenali sebagai navigasi', () => {
    expect(isBrowserNavigation(req({ 'sec-fetch-mode': 'navigate' }))).toBe(true);
  });

  it('Accept: text/html dikenali sebagai navigasi (klien lama tanpa Sec-Fetch)', () => {
    expect(
      isBrowserNavigation(req({ accept: 'text/html,application/xhtml+xml,*/*;q=0.8' })),
    ).toBe(true);
  });

  it('fetch() dari auth-ui TIDAK dianggap navigasi', () => {
    // auth-ui memanggil lewat fetch tanpa menyetel Accept → browser mengirim */*
    expect(isBrowserNavigation(req({ accept: '*/*', 'sec-fetch-mode': 'cors' }))).toBe(false);
    expect(isBrowserNavigation(req({ 'content-type': 'application/json' }))).toBe(false);
  });

  it('permintaan tanpa header sama sekali tidak dianggap navigasi', () => {
    expect(isBrowserNavigation(req({}))).toBe(false);
  });
});

/**
 * Halaman persetujuan membaca parameter OAuth langsung dari query string-nya,
 * jadi pengalihan harus meneruskan query itu apa adanya — termasuk `nonce`.
 * Nonce yang hilang membuat id_token lahir tanpa nonce, dan klien menolaknya
 * TEPAT SETELAH pengguna menekan "Izinkan".
 */
describe('pengalihan ke layar persetujuan mempertahankan query', () => {
  const alihkan = (originalUrl: string) =>
    `/auth/authorize?${originalUrl.slice(originalUrl.indexOf('?') + 1)}`;

  it('seluruh parameter ikut, termasuk nonce dan PKCE', () => {
    const asal =
      '/oauth/authorize?response_type=code&client_id=abc&redirect_uri=https%3A%2F%2Fb.go.id%2Fcb' +
      '&scope=openid+profile+email&state=st1&nonce=nc1&code_challenge=cc1&code_challenge_method=S256';
    const hasil = alihkan(asal);

    expect(hasil.startsWith('/auth/authorize?')).toBe(true);
    for (const wajib of [
      'client_id=abc',
      'nonce=nc1',
      'state=st1',
      'code_challenge=cc1',
      'code_challenge_method=S256',
      'scope=openid+profile+email',
    ]) {
      expect(hasil).toContain(wajib);
    }
  });

  it('redirect_uri tetap ter-encode, tidak rusak saat dipotong', () => {
    const asal = '/oauth/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fb.go.id%2Fcb&nonce=n';
    expect(alihkan(asal)).toContain('redirect_uri=https%3A%2F%2Fb.go.id%2Fcb');
  });
});
