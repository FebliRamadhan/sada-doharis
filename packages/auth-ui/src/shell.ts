/**
 * Panel brand PANRB yang dipakai bersama oleh semua layar auth (login,
 * otorisasi, MFA). Markup statis di index.html memakai kelas yang sama,
 * jadi halaman bershell lama (lupa sandi, daftar, callback) tampil identik.
 */

export const BRAND_TITLE = 'Satu akun untuk semua layanan PANRB.';

export function brandPanel(lede: string, benefits: string[] = []): string {
  const list = benefits.length
    ? `<ul class="brand-benefits">${benefits
        .map(
          (b) => `<li class="brand-benefit">
            <span class="brand-benefit-mark" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
            <span>${b}</span>
          </li>`
        )
        .join('')}</ul>`
    : '';

  return `
    <aside class="sso-brand brand-panel" aria-label="Identitas Kementerian PANRB">
      <div class="brand-logo-card">
        <img src="/logo-panrb.png" alt="Logo Kementerian PANRB" width="203" height="44">
      </div>
      <div class="brand-hero">
        <h2>${BRAND_TITLE}</h2>
        <p>${lede}</p>
        ${list}
      </div>
      <p class="brand-footer">© 2026 Kementerian PANRB, Republik Indonesia</p>
    </aside>
  `;
}

/** Logo untuk layar sempit, saat panel brand disembunyikan. */
export const MOBILE_LOGO = `<img class="sso-mobile-logo" src="/logo-panrb.png" alt="Logo Kementerian PANRB" width="162" height="35">`;
