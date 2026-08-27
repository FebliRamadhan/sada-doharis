/**
 * Login Page — faithful rebuild of the SSO PANRB handoff "Login B Hi-Fi".
 * Full-bleed split screen (brand gradient panel + flat form column), rendered
 * into #app via the `.admin-mode` container override so it replaces the shared
 * card shell. Login + MFA-gate + return_url logic preserved.
 */
import { endpoints, apiRequest, setStoredToken, setStoredUser, type AuthResponse } from '../api';
import { router, getAppContainer, getQueryParams } from '../router';
import { isRegistrationEnabled } from '../runtime-config';
import { MFA_TICKET_KEY, MFA_RETURN_URL_KEY } from './MFAVerifyPage';

const FIELD =
  "width:100%;box-sizing:border-box;height:50px;border:1.5px solid #C8D8EA;border-radius:11px;font:500 14px 'Inter';color:#0D1B2A;background:#fff;outline:none;transition:border-color .15s,box-shadow .15s";

export async function LoginPage(): Promise<void> {
  const app = getAppContainer();
  // Full-bleed: hide the shared split banner, let #app own the viewport.
  document.querySelector('.auth-container')?.classList.add('admin-mode');

  app.innerHTML = `
    <div class="sso-auth">

      <!-- LEFT · BRAND PANEL -->
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
          <div style="font:400 14px/1.6 'Inter';color:rgba(255,255,255,.72);margin-bottom:34px;">Masuk sekali, akses seluruh aplikasi kepegawaian dan layanan internal pemerintah dengan aman.</div>
          <div style="display:flex;flex-direction:column;gap:14px;">
            ${benefit('Single Sign-On terpadu antar instansi')}
            ${benefit('Verifikasi 2 langkah &amp; enkripsi data')}
            ${benefit('Kelola sesi &amp; perangkat aktif')}
          </div>
        </div>

        <div style="position:relative;font:500 11px 'Inter';color:rgba(255,255,255,.5);">© 2026 Kementerian PANRB · Republik Indonesia</div>
      </div>

      <!-- RIGHT · FORM -->
      <div class="sso-form" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 40px;position:relative;overflow-y:auto;">
        <div style="position:absolute;top:28px;right:32px;display:flex;align-items:center;gap:4px;border:1.5px solid #E5EEF7;border-radius:999px;padding:4px;background:#fff;">
          <div style="padding:5px 12px;border-radius:999px;background:#01347C;color:#fff;font:600 11px 'Inter';">ID</div>
          <div style="padding:5px 12px;border-radius:999px;color:#5E7896;font:600 11px 'Inter';">EN</div>
        </div>

        <div style="width:100%;max-width:392px;">
          <div style="font:800 27px 'Plus Jakarta Sans';color:#0D1B2A;margin-bottom:7px;">Masuk ke SSO</div>
          <div style="font:400 14px 'Inter';color:#5E7896;margin-bottom:32px;">Gunakan email instansi untuk melanjutkan.</div>

          <div id="error-alert" class="alert alert-error" role="alert" aria-live="assertive" style="display:none;margin-bottom:18px;">
            <svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span id="error-message"></span>
          </div>

          <form id="login-form" novalidate>
            <!-- Email -->
            <div style="margin-bottom:18px;">
              <div style="font:600 12px 'Inter';color:#354E6B;margin-bottom:8px;">Email</div>
              <div style="position:relative;">
                <div style="position:absolute;left:15px;top:50%;transform:translateY(-50%);display:flex;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9DB2C9" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="m3 7 9 6 9-6"/></svg></div>
                <input id="email" name="email" type="email" placeholder="nama@instansi.go.id" required autocomplete="email" style="${FIELD};padding:0 16px 0 44px;">
              </div>
            </div>

            <!-- Password -->
            <div style="margin-bottom:16px;">
              <div style="font:600 12px 'Inter';color:#354E6B;margin-bottom:8px;">Kata sandi</div>
              <div style="position:relative;">
                <div style="position:absolute;left:15px;top:50%;transform:translateY(-50%);display:flex;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9DB2C9" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>
                <input id="password" name="password" type="password" placeholder="Masukkan kata sandi" required autocomplete="current-password" style="${FIELD};padding:0 46px 0 44px;">
                <button type="button" id="toggle-pw" aria-label="Tampilkan sandi" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);width:34px;height:34px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;">
                  ${eyeIcon(false)}
                </button>
              </div>
            </div>

            <!-- Remember + forgot -->
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
              <label style="display:flex;align-items:center;gap:9px;cursor:pointer;user-select:none;">
                <input type="checkbox" id="remember" checked style="width:19px;height:19px;border-radius:6px;accent-color:#005598;cursor:pointer;">
                <span style="font:500 13px 'Inter';color:#354E6B;">Ingat saya</span>
              </label>
              <a href="/forgot-password" style="font:600 13px 'Inter';color:#005598;text-decoration:none;">Lupa sandi?</a>
            </div>

            <!-- Submit -->
            <button type="submit" id="submit-btn" style="width:100%;height:50px;border:none;border-radius:11px;background:#005598;color:#fff;font:700 14px 'Inter';cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 6px 16px -6px rgba(0,85,152,.5);transition:background .15s;">
              Masuk
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            </button>
          </form>

          ${
            isRegistrationEnabled()
              ? `<div style="text-align:center;margin-top:28px;font:500 13px 'Inter';color:#5E7896;">Belum punya akun? <a href="/register" style="color:#005598;font-weight:600;text-decoration:none;">Daftar</a></div>`
              : ''
          }
        </div>
      </div>
    </div>
  `;

  initLoginForm();
  checkUrlError();
}

function benefit(text: string): string {
  return `<div style="display:flex;align-items:center;gap:12px;">
    <div style="width:26px;height:26px;border-radius:50%;background:rgba(245,194,24,.16);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F5C218" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
    <div style="font:500 13px 'Inter';color:rgba(255,255,255,.86);">${text}</div>
  </div>`;
}

function eyeIcon(open: boolean): string {
  return open
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5E7896" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5E7896" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 5.2A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.5 9.5 0 0 0 4.1-.9"/><path d="m4 4 16 16"/></svg>';
}

function initLoginForm(): void {
  const form = document.getElementById('login-form') as HTMLFormElement | null;
  form?.addEventListener('submit', handleEmailLogin);

  // Focus ring on fields.
  ['email', 'password'].forEach((id) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.addEventListener('focus', () => {
      el.style.borderColor = '#005598';
      el.style.boxShadow = '0 0 0 3px rgba(0,85,152,.13)';
    });
    el?.addEventListener('blur', () => {
      el.style.borderColor = '#C8D8EA';
      el.style.boxShadow = 'none';
    });
  });

  const pw = document.getElementById('password') as HTMLInputElement | null;
  const toggle = document.getElementById('toggle-pw');
  toggle?.addEventListener('click', () => {
    if (!pw) return;
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    toggle.innerHTML = eyeIcon(show);
  });
}

function checkUrlError(): void {
  const params = getQueryParams();

  const error = params.get('error');
  if (error) {
    showError(decodeURIComponent(error));
    return;
  }

  // Ditandai oleh halaman yang memulangkan pengguna karena sesinya benar-benar
  // habis. Tanpa ini mereka mendarat di layar login tanpa penjelasan dan
  // mengira sistemnya yang bermasalah.
  if (params.get('expired') === '1') {
    showError('Sesi Anda telah berakhir. Silakan masuk kembali.');
  }
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

function handleLoginSuccess(data: AuthResponse['data']): void {
  if (!data) return;
  const d = data as unknown as Record<string, unknown>;
  const token = String(d['access_token'] ?? d['accessToken'] ?? '');
  const user = d['user'] as import('../api').User | undefined;
  if (!token || !user) return;

  setStoredToken(token);
  setStoredUser(user);

  const returnUrl = getQueryParams().get('return_url');
  if (returnUrl) {
    window.location.href = returnUrl;
  } else {
    router.navigate('/');
  }
}

async function handleEmailLogin(e: Event): Promise<void> {
  e.preventDefault();
  hideError();

  const email = (document.getElementById('email') as HTMLInputElement).value;
  const password = (document.getElementById('password') as HTMLInputElement).value;
  const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<div class="spinner"></div> Sedang masuk...';

  try {
    const result = await apiRequest<AuthResponse['data']>(endpoints.login, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (result.success && result.data) {
      const d = result.data as unknown as Record<string, unknown>;
      // Internal users are MFA-gated: backend returns a ticket instead of tokens.
      // Carry the OAuth return URL across the MFA hop (query params not preserved).
      const mfaReturnUrl = getQueryParams().get('return_url');
      if (d['mfa_setup_required'] && d['mfa_ticket']) {
        sessionStorage.setItem(MFA_TICKET_KEY, String(d['mfa_ticket']));
        if (mfaReturnUrl) sessionStorage.setItem(MFA_RETURN_URL_KEY, mfaReturnUrl);
        router.navigate('/mfa/setup');
        return;
      }
      if (d['mfa_required'] && d['mfa_ticket']) {
        sessionStorage.setItem(MFA_TICKET_KEY, String(d['mfa_ticket']));
        if (mfaReturnUrl) sessionStorage.setItem(MFA_RETURN_URL_KEY, mfaReturnUrl);
        router.navigate('/mfa/verify');
        return;
      }
      handleLoginSuccess(result.data);
    } else {
      showError(result.error || 'Email atau kata sandi salah.');
    }
  } catch {
    showError('Terjadi kesalahan jaringan. Silakan coba kembali.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML =
      'Masuk <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  }
}
