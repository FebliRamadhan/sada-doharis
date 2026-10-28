/**
 * Ganti Password LDAP — dua pintu masuk, satu form (password lama / baru / konfirmasi):
 *
 *  - Wajib: tiket dari login saat password kedaluwarsa (setelah password + MFA).
 *    Tidak bisa dilewati; satu-satunya jalan keluar adalah kembali ke login.
 *  - Sukarela: user yang sudah login, dari menu profil Portal atau layar
 *    peringatan.
 *
 * Password lama diketik ulang di sini — SADA tidak pernah menahannya
 * (docs/adr/0002). Syarat di bawah hanya umpan balik; server yang memutuskan.
 */
import {
  endpoints,
  apiRequest,
  getStoredToken,
  setStoredToken,
  setStoredUser,
  type User,
} from '../api';
import { router, getAppContainer } from '../router';
import { PWD_TICKET_KEY, PWD_RETURN_URL_KEY, goToReturnUrl } from '../password-gate';
import { brandPanel, MOBILE_LOGO } from '../shell';

const MIN_LENGTH = 12;

const RULES: { id: string; label: string; test: (pw: string) => boolean }[] = [
  { id: 'len', label: `Minimal ${MIN_LENGTH} karakter`, test: (pw) => pw.length >= MIN_LENGTH },
  {
    id: 'mix',
    label: '3 dari 4: huruf kecil, huruf besar, angka, simbol',
    test: (pw) =>
      [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(pw)).length >= 3,
  },
];

export async function ChangePasswordPage(): Promise<void> {
  const ticket = sessionStorage.getItem(PWD_TICKET_KEY);

  if (!ticket && !getStoredToken()) {
    router.navigate('/login', true);
    return;
  }

  document.querySelector('.auth-container')?.classList.add('admin-mode');
  render(Boolean(ticket));
  initForm(ticket);
}

function render(forced: boolean): void {
  const intro = forced
    ? 'Password Anda sudah melewati masa berlaku 90 hari. Ganti sekarang untuk melanjutkan.'
    : 'Password baru berlaku untuk email kantor dan semua layanan yang memakai akun PANRB Anda.';

  getAppContainer().innerHTML = `
    <div class="sso-auth">
      ${brandPanel('Password LDAP Anda berlaku 90 hari dan dipakai untuk email kantor serta semua layanan PANRB.')}
      <div class="sso-form">
        ${MOBILE_LOGO}
        <div class="sso-form-body">
          <div class="form-header">
            <h1>${forced ? 'Password kedaluwarsa' : 'Ganti password'}</h1>
            <p>${intro}</p>
          </div>

          <div id="error-alert" class="alert alert-error" role="alert" aria-live="assertive" style="display:none;">
            <svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <div id="error-message"></div>
          </div>

          <form id="pwd-form" novalidate>
            ${field('old_password', 'Password lama', 'current-password')}
            ${field('new_password', 'Password baru', 'new-password', 'pwd-rules')}
            <ul id="pwd-rules" class="pwd-rules">
              ${RULES.map((r) => `<li data-rule="${r.id}">${r.label}</li>`).join('')}
            </ul>
            ${field('confirm_password', 'Ulangi password baru', 'new-password')}
            <button type="submit" id="submit-btn" class="btn btn-primary">Ganti password</button>
          </form>

          <div class="auth-links">
            ${
              forced
                ? '<a class="text-link is-quiet" href="/login" id="pwd-back">Batal dan kembali ke login</a>'
                : '<a class="text-link is-quiet" href="/portal" id="pwd-back">Batal</a>'
            }
          </div>
        </div>
      </div>
    </div>
  `;
}

function field(id: string, label: string, autocomplete: string, describedBy?: string): string {
  return `
    <div class="form-group">
      <label class="form-label" for="${id}">${label}</label>
      <input type="password" id="${id}" class="form-input is-plain" required autocomplete="${autocomplete}"${describedBy ? ` aria-describedby="${describedBy}"` : ''}>
    </div>
  `;
}

function showErrors(messages: string[]): void {
  const alert = document.getElementById('error-alert');
  const box = document.getElementById('error-message');
  if (!alert || !box) return;
  box.replaceChildren(
    ...messages.map((m) => {
      const line = document.createElement('div');
      line.textContent = m;
      return line;
    })
  );
  alert.style.display = 'flex';
}

function hideErrors(): void {
  const alert = document.getElementById('error-alert');
  if (alert) alert.style.display = 'none';
}

function initForm(ticket: string | null): void {
  const form = document.getElementById('pwd-form') as HTMLFormElement | null;
  const input = (id: string) => document.getElementById(id) as HTMLInputElement;

  input('new_password').addEventListener('input', () => {
    const pw = input('new_password').value;
    RULES.forEach((r) => {
      const li = document.querySelector<HTMLElement>(`[data-rule="${r.id}"]`);
      if (!li) return;
      li.classList.toggle('is-ok', r.test(pw));
    });
  });

  document.getElementById('pwd-back')?.addEventListener('click', () => {
    sessionStorage.removeItem(PWD_TICKET_KEY);
    sessionStorage.removeItem(PWD_RETURN_URL_KEY);
  });

  input('old_password').focus();

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideErrors();

    const oldPassword = input('old_password').value;
    const newPassword = input('new_password').value;
    const confirm = input('confirm_password').value;

    const local: string[] = [];
    if (!oldPassword) local.push('Isi password lama.');
    RULES.filter((r) => !r.test(newPassword)).forEach((r) => local.push(`${r.label}.`));
    if (newPassword !== confirm) local.push('Konfirmasi password tidak sama.');
    if (local.length) {
      showErrors(local);
      return;
    }

    const btn = document.getElementById('submit-btn') as HTMLButtonElement;
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Mengganti…';

    try {
      const result = await apiRequest<Record<string, unknown>>(
        ticket ? endpoints.passwordChangeExpired : endpoints.passwordChange,
        {
          method: 'POST',
          body: JSON.stringify({
            ...(ticket ? { ticket } : {}),
            old_password: oldPassword,
            new_password: newPassword,
          }),
        }
      );

      if (result.success && result.data) {
        const token = String(result.data['access_token'] ?? '');
        const user = result.data['user'] as User | undefined;
        if (token && user) {
          setStoredToken(token);
          setStoredUser(user);
        }
        sessionStorage.removeItem(PWD_TICKET_KEY);
        const returnUrl = sessionStorage.getItem(PWD_RETURN_URL_KEY);
        sessionStorage.removeItem(PWD_RETURN_URL_KEY);
        goToReturnUrl(returnUrl);
        return;
      }

      const detailMessages = Object.values(result.details ?? {}).flat();
      showErrors(
        detailMessages.length ? detailMessages : [result.error || 'Password gagal diganti.']
      );

      // Tiket habis (401 pada jalur wajib) → harus login ulang.
      if (ticket && result.status === 401) {
        sessionStorage.removeItem(PWD_TICKET_KEY);
        setTimeout(() => router.navigate('/login', true), 1800);
      }
    } catch {
      showErrors(['Terjadi kesalahan jaringan. Silakan coba kembali.']);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ganti password';
    }
  });
}
