/**
 * MFA Setup Page — forced TOTP enrollment for internal users.
 * Reads the setup ticket stashed by LoginPage, shows a QR + secret, confirms the
 * first code, then shows one-time backup codes and completes login.
 */
import { endpoints, apiRequest, setStoredToken, setStoredUser, type User } from '../api';
import { router, getAppContainer, getQueryParams } from '../router';
import { MFA_TICKET_KEY, MFA_RETURN_URL_KEY } from './MFAVerifyPage';
import { continueAfterLogin, redirectIfPasswordChangeRequired } from '../password-gate';
import { brandPanel, MOBILE_LOGO } from '../shell';

interface SetupData {
  secret: string;
  uri: string;
  qr: string;
}

export async function MFASetupPage(): Promise<void> {
  const app = getAppContainer();
  const ticket = sessionStorage.getItem(MFA_TICKET_KEY);

  if (!ticket) {
    router.navigate('/login', true);
    return;
  }

  document.querySelector('.auth-container')?.classList.add('admin-mode');

  app.innerHTML = `
    <div class="sso-auth">
      ${brandPanel('Aktifkan verifikasi 2 langkah untuk mengamankan akun PANRB Anda.')}
      <div class="sso-form">
        ${MOBILE_LOGO}
        <div class="sso-form-body">
          <div class="form-header">
            <h1>Aktifkan verifikasi dua langkah</h1>
            <p>Akun internal wajib menggunakan MFA. Pindai QR di bawah dengan aplikasi
               authenticator (Google Authenticator, Authy, dll).</p>
          </div>

          <div id="error-alert" class="alert alert-error" role="alert" aria-live="assertive" style="display: none;">
            <svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span id="error-message"></span>
          </div>

          <div id="setup-body">
            <div class="loading-state"><div class="spinner spinner-dark spinner-lg"></div><p>Menyiapkan…</p></div>
          </div>
        </div>
      </div>
    </div>
  `;

  await loadSetup(ticket);
}

function showError(message: string): void {
  const alert = document.getElementById('error-alert');
  const msg = document.getElementById('error-message');
  if (alert && msg) {
    msg.textContent = message;
    alert.style.display = 'flex';
  }
}

function hideError(): void {
  const alert = document.getElementById('error-alert');
  if (alert) alert.style.display = 'none';
}

async function loadSetup(ticket: string): Promise<void> {
  const body = document.getElementById('setup-body');
  if (!body) return;

  const result = await apiRequest<SetupData>(endpoints.mfaSetup, {
    method: 'POST',
    body: JSON.stringify({ ticket }),
  });

  if (!result.success || !result.data) {
    showError(result.error || 'Gagal memulai pengaturan MFA.');
    if ((result.error || '').toLowerCase().includes('sign in again')) {
      sessionStorage.removeItem(MFA_TICKET_KEY);
      setTimeout(() => router.navigate('/login', true), 1500);
    }
    return;
  }

  const { qr, secret } = result.data;
  body.innerHTML = `
    <ol class="auth-steps">
      <li class="auth-step">
        <p class="auth-step-title">Pindai kode QR</p>
        <img class="qr-frame" src="${qr}" alt="Kode QR untuk aplikasi authenticator" width="176" height="176" />
        <p class="auth-step-note">Tidak bisa memindai? Masukkan kode ini secara manual:</p>
        <code class="secret-code">${secret}</code>
      </li>
      <li class="auth-step">
        <form id="enable-form" novalidate>
          <label class="auth-step-title" for="enable-code">Masukkan kode dari authenticator</label>
          <input type="text" id="enable-code" class="form-input is-plain is-code" inputmode="numeric"
                 autocomplete="one-time-code" placeholder="123456" required>
          <button type="submit" class="btn btn-primary" id="enable-btn">Aktifkan dan lanjutkan</button>
        </form>
      </li>
    </ol>
  `;

  const form = document.getElementById('enable-form') as HTMLFormElement | null;
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    void confirmEnable(ticket);
  });
}

async function confirmEnable(ticket: string): Promise<void> {
  hideError();
  const code =
    (document.getElementById('enable-code') as HTMLInputElement | null)?.value.trim() ?? '';
  const btn = document.getElementById('enable-btn') as HTMLButtonElement;
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Mengaktifkan…';

  try {
    const result = await apiRequest<Record<string, unknown>>(endpoints.mfaEnable, {
      method: 'POST',
      body: JSON.stringify({ ticket, code }),
    });
    if (result.success && result.data) {
      showBackupCodes(result.data);
    } else {
      showError(result.error || 'Kode tidak valid.');
      btn.disabled = false;
      btn.textContent = 'Aktifkan dan lanjutkan';
    }
  } catch {
    showError('Terjadi kesalahan jaringan. Silakan coba kembali.');
    btn.disabled = false;
    btn.textContent = 'Aktifkan dan lanjutkan';
  }
}

function showBackupCodes(data: Record<string, unknown>): void {
  const codes = (data['backup_codes'] as string[] | undefined) ?? [];
  const token = String(data['access_token'] ?? '');
  const user = data['user'] as User | undefined;

  // Persist the freshly-issued login immediately so "Lanjutkan" can proceed.
  if (token && user) {
    setStoredToken(token);
    setStoredUser(user);
  }
  sessionStorage.removeItem(MFA_TICKET_KEY);

  const body = document.getElementById('setup-body');
  if (!body) return;

  body.innerHTML = `
    <div class="alert alert-success" role="status">
      <svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
      <span>MFA aktif. Simpan kode cadangan ini di tempat aman; masing-masing hanya bisa dipakai sekali.</span>
    </div>

    <ul class="backup-codes">
      ${codes.map((c) => `<li><code>${c}</code></li>`).join('')}
    </ul>

    <div class="auth-actions">
      <button type="button" class="btn btn-primary" id="continue-btn">Saya sudah menyimpan, lanjutkan</button>
      <button type="button" class="btn btn-secondary" id="copy-codes">Salin kode</button>
    </div>
  `;

  document.getElementById('copy-codes')?.addEventListener('click', () => {
    void navigator.clipboard?.writeText(codes.join('\n'));
  });
  document.getElementById('continue-btn')?.addEventListener('click', () => {
    const returnUrl =
      getQueryParams().get('return_url') ?? sessionStorage.getItem(MFA_RETURN_URL_KEY);
    sessionStorage.removeItem(MFA_RETURN_URL_KEY);
    // Password kedaluwarsa: server mengirim tiket ganti password bersama kode cadangan.
    if (redirectIfPasswordChangeRequired(data, returnUrl)) return;
    continueAfterLogin(user, returnUrl);
  });
}
