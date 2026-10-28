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
import { continueAfterLogin, redirectIfPasswordChangeRequired } from '../password-gate';
import { brandPanel, MOBILE_LOGO } from '../shell';

const ARROW =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

export async function LoginPage(): Promise<void> {
  const app = getAppContainer();
  // Full-bleed: hide the shared split banner, let #app own the viewport.
  document.querySelector('.auth-container')?.classList.add('admin-mode');

  app.innerHTML = `
    <div class="sso-auth">
      ${brandPanel(
        'Masuk sekali, akses seluruh aplikasi kepegawaian dan layanan internal pemerintah dengan aman.',
        [
          'Single Sign-On terpadu antar instansi',
          'Verifikasi 2 langkah &amp; enkripsi data',
          'Kelola sesi &amp; perangkat aktif',
        ]
      )}

      <div class="sso-form">
        ${MOBILE_LOGO}
        <div class="sso-form-body">
          <div class="form-header">
            <h1>Masuk ke SSO</h1>
            <p>Gunakan email instansi untuk melanjutkan.</p>
          </div>

          <div id="error-alert" class="alert alert-error" role="alert" aria-live="assertive" style="display:none;">
            <svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span id="error-message"></span>
          </div>

          <form id="login-form" novalidate>
            <div class="form-group">
              <label class="form-label" for="email">Email</label>
              <div class="input-wrapper">
                <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="m3 7 9 6 9-6"/></svg>
                <input id="email" name="email" type="email" class="form-input" placeholder="nama@instansi.go.id" required autocomplete="email">
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="password">Kata sandi</label>
              <div class="input-wrapper">
                <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
                <input id="password" name="password" type="password" class="form-input has-trailing" placeholder="Masukkan kata sandi" required autocomplete="current-password">
                <button type="button" id="toggle-pw" class="input-trailing-btn" aria-label="Tampilkan sandi">
                  ${eyeIcon(false)}
                </button>
              </div>
            </div>

            <div class="form-row">
              <label class="check-label">
                <input type="checkbox" id="remember" checked>
                <span>Ingat saya</span>
              </label>
              <a class="text-link" href="/forgot-password">Lupa sandi?</a>
            </div>

            <button type="submit" id="submit-btn" class="btn btn-primary">Masuk ${ARROW}</button>
          </form>

          ${
            isRegistrationEnabled()
              ? `<p class="auth-footer">Belum punya akun? <a href="/register">Daftar</a></p>`
              : ''
          }
        </div>
      </div>
    </div>
  `;

  initLoginForm();
  checkUrlError();
}

function eyeIcon(open: boolean): string {
  return open
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.9 5.2A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.5 9.5 0 0 0 4.1-.9"/><path d="m4 4 16 16"/></svg>';
}

function initLoginForm(): void {
  const form = document.getElementById('login-form') as HTMLFormElement | null;
  form?.addEventListener('submit', handleEmailLogin);

  const pw = document.getElementById('password') as HTMLInputElement | null;
  const toggle = document.getElementById('toggle-pw');
  toggle?.addEventListener('click', () => {
    if (!pw) return;
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    toggle.innerHTML = eyeIcon(show);
    toggle.setAttribute('aria-label', show ? 'Sembunyikan sandi' : 'Tampilkan sandi');
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

  continueAfterLogin(user, getQueryParams().get('return_url'));
}

async function handleEmailLogin(e: Event): Promise<void> {
  e.preventDefault();
  hideError();

  const email = (document.getElementById('email') as HTMLInputElement).value;
  const password = (document.getElementById('password') as HTMLInputElement).value;
  const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<div class="spinner"></div> Sedang masuk…';

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
      // Hanya tercapai di sini bila MFA dimatikan di server.
      if (redirectIfPasswordChangeRequired(d, mfaReturnUrl)) return;
      handleLoginSuccess(result.data);
    } else {
      showError(result.error || 'Email atau kata sandi salah.');
    }
  } catch {
    showError('Terjadi kesalahan jaringan. Silakan coba kembali.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `Masuk ${ARROW}`;
  }
}
