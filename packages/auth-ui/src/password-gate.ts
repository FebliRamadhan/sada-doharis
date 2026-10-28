/**
 * Masa Berlaku Password LDAP di sisi UI.
 *
 *  - Kedaluwarsa: setelah password + MFA, server menjawab
 *    `password_change_required` + `password_ticket` alih-alih token. Tiket dan
 *    return_url dibawa ke /password/change.
 *  - Peringatan (hari ke-76 s.d. 89): login selesai normal, tapi sebelum
 *    diteruskan ke aplikasi user melihat layar peringatan yang bisa dilewati.
 */
import type { User } from './api';
import { router, getAppContainer } from './router';
import { brandPanel, MOBILE_LOGO } from './shell';

export const PWD_TICKET_KEY = 'sada_pwd_ticket';
export const PWD_RETURN_URL_KEY = 'sada_pwd_return_url';

/** Ke tujuan login semula (aplikasi OAuth) atau beranda SSO. */
export function goToReturnUrl(returnUrl: string | null): void {
  if (returnUrl) window.location.href = returnUrl;
  else router.navigate('/');
}

/** True bila respons login meminta ganti password; navigasi sudah dilakukan. */
export function redirectIfPasswordChangeRequired(
  data: Record<string, unknown>,
  returnUrl: string | null
): boolean {
  if (!data['password_change_required'] || !data['password_ticket']) return false;
  sessionStorage.setItem(PWD_TICKET_KEY, String(data['password_ticket']));
  if (returnUrl) sessionStorage.setItem(PWD_RETURN_URL_KEY, returnUrl);
  else sessionStorage.removeItem(PWD_RETURN_URL_KEY);
  router.navigate('/password/change');
  return true;
}

/**
 * Lanjutkan login ke returnUrl, kecuali password sedang dalam masa peringatan:
 * tampilkan dulu layar peringatan dengan pilihan "Ganti sekarang" atau "Nanti saja".
 */
export function continueAfterLogin(user: User | undefined, returnUrl: string | null): void {
  const expiry = user?.passwordExpiry;
  if (!expiry || expiry.status !== 'warning' || expiry.daysLeft === null) {
    goToReturnUrl(returnUrl);
    return;
  }

  document.querySelector('.auth-container')?.classList.add('admin-mode');
  getAppContainer().innerHTML = `
    <div class="sso-auth">
      ${brandPanel('Password LDAP Anda berlaku 90 hari dan dipakai untuk email kantor serta semua layanan PANRB.')}
      <div class="sso-form">
        ${MOBILE_LOGO}
        <div class="sso-form-body">
          <div class="form-header">
            <h1>Password segera kedaluwarsa</h1>
            <p>Password Anda kedaluwarsa dalam <b>${expiry.daysLeft} hari</b>. Setelah itu Anda wajib menggantinya sebelum bisa masuk.</p>
          </div>
          <div class="auth-actions">
            <button type="button" id="pwd-warn-change" class="btn btn-primary">Ganti sekarang</button>
            <button type="button" id="pwd-warn-later" class="btn btn-secondary">Nanti saja</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document
    .getElementById('pwd-warn-later')
    ?.addEventListener('click', () => goToReturnUrl(returnUrl));
  document.getElementById('pwd-warn-change')?.addEventListener('click', () => {
    // Ganti sukarela (user sudah login): setelah selesai, kembali ke tujuan semula.
    sessionStorage.removeItem(PWD_TICKET_KEY);
    if (returnUrl) sessionStorage.setItem(PWD_RETURN_URL_KEY, returnUrl);
    else sessionStorage.removeItem(PWD_RETURN_URL_KEY);
    router.navigate('/password/change');
  });
}
