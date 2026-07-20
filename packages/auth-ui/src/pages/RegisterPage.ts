/**
 * Register Page — new PANRB account sign-up.
 * UI follows the SSO PANRB handoff "Registrasi" screen: nama + NIP row, email
 * instansi, instansi/kementerian select, password with show/hide, agree checkbox,
 * then a success state. Wired to POST /auth/register (returns token + user).
 *
 * NOTE: the backend register schema only accepts { email, password, name }.
 * NIP and Instansi are captured per the design but NOT yet persisted — extend
 * the backend (registerSchema + userService.register) to store them.
 */
import { endpoints, apiRequest, setStoredToken, setStoredUser, type User } from '../api';
import { router, getAppContainer, getQueryParams } from '../router';

// Kementerian/Lembaga — minimal starter list; replace with a real instansi source.
const INSTANSI = [
  'Kementerian PANRB',
  'Kementerian Keuangan',
  'Kementerian Dalam Negeri',
  'Kementerian Komunikasi dan Digital',
  'Badan Kepegawaian Negara (BKN)',
  'Pemerintah Provinsi',
  'Pemerintah Kabupaten/Kota',
  'Lainnya',
];

const chevron =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5E7896" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="position:absolute;right:var(--space-4);top:50%;transform:translateY(-50%);pointer-events:none;"><polyline points="6 9 12 15 18 9"/></svg>';

function eyeIcon(open: boolean): string {
  return open
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
}

export async function RegisterPage(): Promise<void> {
  const app = getAppContainer();

  app.innerHTML = `
    <div class="auth-card">
      <div class="mobile-brand-header" aria-hidden="true">
        <img src="/logo-panrb.png" alt="Logo Kementerian PANRB" height="44" style="width:auto;">
      </div>

      <div class="form-header">
        <h1>Buat akun</h1>
        <p>Daftarkan akun PANRB Anda untuk mengakses layanan PANRB.</p>
      </div>

      <div id="error-alert" class="alert alert-error" role="alert" aria-live="assertive" style="display:none;">
        <svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span id="error-message"></span>
      </div>

      <form id="register-form" novalidate>
        <!-- Nama lengkap + NIP -->
        <div class="form-group">
          <div style="display:grid;grid-template-columns:1fr 150px;gap:var(--space-3);">
            <div>
              <label class="form-label" for="name">Nama lengkap</label>
              <div class="input-wrapper">
                <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
                <input type="text" id="name" name="name" class="form-input" placeholder="Nama sesuai SK" required autocomplete="name">
              </div>
            </div>
            <div>
              <label class="form-label" for="nip">NIP</label>
              <div class="input-wrapper">
                <input type="text" id="nip" name="nip" class="form-input" placeholder="18 digit" inputmode="numeric"
                       autocomplete="off" style="padding-left:var(--space-4);letter-spacing:.02em;">
              </div>
            </div>
          </div>
        </div>

        <!-- Email instansi -->
        <div class="form-group">
          <label class="form-label" for="email">Email instansi</label>
          <div class="input-wrapper">
            <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
            </svg>
            <input type="email" id="email" name="email" class="form-input" placeholder="anda@instansi.go.id" required autocomplete="email">
          </div>
        </div>

        <!-- Instansi / Kementerian -->
        <div class="form-group">
          <label class="form-label" for="instansi">Instansi / Kementerian</label>
          <div class="input-wrapper">
            <select id="instansi" name="instansi" class="form-input" style="padding-left:var(--space-4);padding-right:calc(var(--space-4) + 22px);appearance:none;cursor:pointer;">
              <option value="" disabled selected>Pilih instansi</option>
              ${INSTANSI.map((i) => `<option value="${i}">${i}</option>`).join('')}
            </select>
            ${chevron}
          </div>
        </div>

        <!-- Kata sandi -->
        <div class="form-group">
          <label class="form-label" for="password">Kata sandi</label>
          <div class="input-wrapper">
            <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <input type="password" id="password" name="password" class="form-input" placeholder="Minimal 8 karakter"
                   required autocomplete="new-password" style="padding-right:calc(var(--space-4) + 28px);">
            <button type="button" id="toggle-pw" aria-label="Tampilkan kata sandi"
                    style="position:absolute;right:var(--space-3);top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--color-text-muted);display:flex;padding:4px;">
              ${eyeIcon(false)}
            </button>
          </div>
        </div>

        <!-- Agree -->
        <label style="display:flex;align-items:flex-start;gap:var(--space-2);margin-bottom:var(--space-5);font-size:var(--font-sm);color:var(--color-text-secondary);cursor:pointer;">
          <input type="checkbox" id="agree" class="admin-checkbox" style="margin-top:2px;">
          <span>Saya menyetujui <a href="#" style="color:var(--panrb-blue);font-weight:600;">Syarat Layanan</a> dan <a href="#" style="color:var(--panrb-blue);font-weight:600;">Kebijakan Privasi</a>.</span>
        </label>

        <button type="submit" class="btn btn-primary" id="submit-btn">Daftar &amp; verifikasi</button>
      </form>

      <div class="auth-footer">
        Sudah punya akun? <a href="/login" id="to-login">Masuk</a>
      </div>
    </div>
  `;

  initForm();
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

function redirectAfter(): void {
  const returnUrl = getQueryParams().get('return_url');
  if (returnUrl) {
    window.location.href = returnUrl;
  } else {
    router.navigate('/');
  }
}

function showSuccess(): void {
  const app = getAppContainer();
  app.innerHTML = `
    <div class="auth-card" style="text-align:center;">
      <div style="width:64px;height:64px;border-radius:var(--radius-full);background:#E8F5EC;color:var(--color-success);display:flex;align-items:center;justify-content:center;margin:0 auto var(--space-5);">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
      </div>
      <div class="form-header" style="text-align:center;">
        <h1>Akun berhasil dibuat</h1>
        <p>Anda sudah masuk. Lanjutkan ke portal layanan PANRB.</p>
      </div>
      <button type="button" class="btn btn-primary" id="continue-btn">Buka Portal</button>
    </div>
  `;
  document.getElementById('continue-btn')?.addEventListener('click', redirectAfter);
}

function initForm(): void {
  const form = document.getElementById('register-form') as HTMLFormElement | null;
  const pw = document.getElementById('password') as HTMLInputElement | null;
  const togglePw = document.getElementById('toggle-pw');

  togglePw?.addEventListener('click', () => {
    if (!pw) return;
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    togglePw.innerHTML = eyeIcon(show);
    togglePw.setAttribute('aria-label', show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const name = (document.getElementById('name') as HTMLInputElement).value.trim();
    const email = (document.getElementById('email') as HTMLInputElement).value.trim();
    const password = (document.getElementById('password') as HTMLInputElement).value;
    const agree = (document.getElementById('agree') as HTMLInputElement).checked;

    if (!name || !email) {
      showError('Nama dan email instansi wajib diisi.');
      return;
    }
    if (password.length < 8) {
      showError('Kata sandi minimal 8 karakter.');
      return;
    }
    if (!agree) {
      showError('Anda harus menyetujui Syarat Layanan dan Kebijakan Privasi.');
      return;
    }

    const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="spinner"></div> Mendaftar...';

    try {
      // Backend accepts only { name, email, password }; NIP/instansi not yet persisted.
      const result = await apiRequest<Record<string, unknown>>(endpoints.register, {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      });

      if (result.success && result.data) {
        const d = result.data;
        const token = String(d['access_token'] ?? '');
        const user = d['user'] as User | undefined;
        if (token && user) {
          setStoredToken(token);
          setStoredUser(user);
        }
        showSuccess();
      } else {
        showError(result.error || 'Pendaftaran gagal. Silakan coba lagi.');
      }
    } catch {
      showError('Terjadi kesalahan jaringan. Silakan coba kembali.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Daftar & verifikasi';
    }
  });
}
