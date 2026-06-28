/**
 * MFA Setup Page — forced TOTP enrollment for internal users.
 * Reads the setup ticket stashed by LoginPage, shows a QR + secret, confirms the
 * first code, then shows one-time backup codes and completes login.
 */
import { endpoints, apiRequest, setStoredToken, setStoredUser, type User } from '../api';
import { router, getAppContainer, getQueryParams } from '../router';
import { MFA_TICKET_KEY, MFA_RETURN_URL_KEY } from './MFAVerifyPage';

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
      ${brandPanel()}
      <div class="sso-form" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 40px;position:relative;overflow-y:auto;">
        <div style="width:100%;max-width:420px;">
          <div class="form-header">
            <h1>Aktifkan Verifikasi Dua Langkah</h1>
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
            <div class="loading-state"><div class="spinner spinner-dark spinner-lg"></div><p>Menyiapkan...</p></div>
          </div>
        </div>
      </div>
    </div>
  `;

  await loadSetup(ticket);
}

function brandPanel(): string {
  return `
    <div class="sso-brand" style="position:relative;width:46%;min-width:420px;overflow:hidden;padding:56px 56px 44px;display:flex;flex-direction:column;justify-content:space-between;color:#fff;background:radial-gradient(circle at 16% 10%, rgba(245,194,24,.18), transparent 40%), radial-gradient(circle at 88% 92%, rgba(40,148,217,.28), transparent 46%), linear-gradient(158deg,#01347C 0%,#00235A 100%);">
      <div style="position:absolute;top:-120px;right:-120px;width:340px;height:340px;border-radius:50%;border:1.5px solid rgba(255,255,255,.07)"></div>
      <div style="position:absolute;top:-60px;right:-60px;width:220px;height:220px;border-radius:50%;border:1.5px solid rgba(255,255,255,.07)"></div>
      <div style="position:relative;">
        <div style="display:inline-flex;align-items:center;background:#fff;border-radius:14px;padding:10px 18px;box-shadow:0 4px 20px rgba(0,0,0,.25);">
          <img src="/logo-panrb.png" alt="Logo Kementerian PANRB" style="height:44px;width:auto;display:block;">
        </div>
      </div>
      <div style="position:relative;max-width:380px;">
        <div style="font:800 34px/1.18 'Plus Jakarta Sans';margin-bottom:16px;">Satu akun untuk semua layanan PANRB.</div>
        <div style="font:400 14px/1.6 'Inter';color:rgba(255,255,255,.72);">Aktifkan verifikasi 2 langkah untuk mengamankan akun PANRB Anda.</div>
      </div>
      <div style="position:relative;font:500 11px 'Inter';color:rgba(255,255,255,.5);">© 2026 Kementerian PANRB · Republik Indonesia</div>
    </div>
  `;
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
    <div style="text-align:center; margin-bottom: var(--space-5);">
      <img src="${qr}" alt="QR code MFA" width="200" height="200"
           style="display:block; margin:0 auto; border-radius: var(--radius-lg); border: 1px solid var(--color-border);" />
      <p style="font-size: var(--font-xs); color: var(--color-text-muted); margin-top: var(--space-2);">
        Tidak bisa memindai? Masukkan kode ini secara manual:
      </p>
      <code style="display:inline-block; font-size: var(--font-sm); font-weight:600; letter-spacing:.1em;
                   background: var(--color-surface-muted); padding: var(--space-2) var(--space-3);
                   border-radius: var(--radius-md); word-break: break-all;">${secret}</code>
    </div>

    <form id="enable-form" novalidate>
      <div class="form-group">
        <label class="form-label" for="enable-code">Kode dari Authenticator</label>
        <div class="input-wrapper">
          <input type="text" id="enable-code" class="form-input" inputmode="numeric"
                 autocomplete="one-time-code" placeholder="123456" required
                 style="padding-left: var(--space-4); letter-spacing:.3em;">
        </div>
      </div>
      <button type="submit" class="btn btn-primary" id="enable-btn">Aktifkan &amp; Lanjutkan</button>
    </form>
  `;

  const form = document.getElementById('enable-form') as HTMLFormElement | null;
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    void confirmEnable(ticket);
  });
}

async function confirmEnable(ticket: string): Promise<void> {
  hideError();
  const code = (document.getElementById('enable-code') as HTMLInputElement | null)?.value.trim() ?? '';
  const btn = document.getElementById('enable-btn') as HTMLButtonElement;
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Mengaktifkan...';

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
      btn.textContent = 'Aktifkan & Lanjutkan';
    }
  } catch {
    showError('Terjadi kesalahan jaringan. Silakan coba kembali.');
    btn.disabled = false;
    btn.textContent = 'Aktifkan & Lanjutkan';
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
    <div class="alert alert-success" role="alert" style="margin-bottom: var(--space-5);">
      <svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>
      <span>MFA aktif. Simpan kode cadangan ini di tempat aman — masing-masing hanya bisa dipakai sekali.</span>
    </div>

    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--space-2);
                background: var(--color-surface-muted); padding: var(--space-4);
                border-radius: var(--radius-lg); margin-bottom: var(--space-5);">
      ${codes
        .map(
          (c) =>
            `<code style="font-size: var(--font-sm); font-weight:600; letter-spacing:.08em; text-align:center;">${c}</code>`
        )
        .join('')}
    </div>

    <button type="button" class="btn btn-secondary" id="copy-codes" style="margin-bottom: var(--space-3);">
      Salin kode
    </button>
    <button type="button" class="btn btn-primary" id="continue-btn">Saya sudah menyimpan — Lanjutkan</button>
  `;

  document.getElementById('copy-codes')?.addEventListener('click', () => {
    void navigator.clipboard?.writeText(codes.join('\n'));
  });
  document.getElementById('continue-btn')?.addEventListener('click', () => {
    const returnUrl =
      getQueryParams().get('return_url') ?? sessionStorage.getItem(MFA_RETURN_URL_KEY);
    sessionStorage.removeItem(MFA_RETURN_URL_KEY);
    if (returnUrl) {
      window.location.href = returnUrl;
    } else {
      router.navigate('/');
    }
  });
}
