/**
 * Forgot Password Page — 3-step reset flow + success, per SSO PANRB handoff #6:
 *   Step 1  email        → POST /auth/forgot-password
 *   Step 2  OTP (6 box)   → POST /auth/verify-reset-code
 *   Step 3  new password  → POST /auth/reset-password (with strength meter)
 *   Step 4  success
 *
 * No mailer is wired server-side yet, so /auth/forgot-password returns `dev_code`
 * in non-production; we surface it as a hint so the flow is testable locally.
 */
import { endpoints, apiRequest } from '../api';
import { getAppContainer } from '../router';

const OTP_LEN = 6;

const otpBoxStyle =
  'width:48px;height:58px;border:1.5px solid #C8D8EA;border-radius:11px;text-align:center;' +
  "font:700 22px 'Inter';color:#0D1B2A;background:#fff;outline:none;transition:border-color .15s,box-shadow .15s";

interface State {
  step: 1 | 2 | 3 | 4;
  email: string;
  code: string;
}

const state: State = { step: 1, email: '', code: '' };

export async function ForgotPasswordPage(): Promise<void> {
  // Reset on each fresh navigation.
  state.step = 1;
  state.email = '';
  state.code = '';
  render();
}

function shell(inner: string): string {
  return `
    <div class="auth-card">
      <div class="mobile-brand-header" aria-hidden="true">
        <img src="/logo-panrb.png" alt="Logo Kementerian PANRB" height="44" style="width:auto;">
      </div>
      <div id="error-alert" class="alert alert-error" role="alert" aria-live="assertive" style="display:none;">
        <svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span id="error-message"></span>
      </div>
      ${inner}
    </div>`;
}

function lockIcon(): string {
  return `<div style="width:52px;height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:#EEF4FB;margin-bottom:var(--space-5);">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#005598" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  </div>`;
}

function render(): void {
  const app = getAppContainer();
  if (state.step === 1) {
    app.innerHTML = shell(`
      ${lockIcon()}
      <div class="form-header"><h1>Lupa kata sandi?</h1><p>Masukkan email instansi Anda. Kami akan mengirim kode verifikasi.</p></div>
      <form id="email-form" novalidate>
        <div class="form-group">
          <label class="form-label" for="email">Alamat Email</label>
          <div class="input-wrapper">
            <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
            </svg>
            <input type="email" id="email" class="form-input" placeholder="anda@instansi.go.id" required autocomplete="email">
          </div>
        </div>
        <button type="submit" class="btn btn-primary" id="submit-btn">Kirim kode</button>
      </form>
      <div class="auth-footer"><a href="/login">Kembali masuk</a></div>
    `);
    initEmailStep();
  } else if (state.step === 2) {
    app.innerHTML = shell(`
      ${lockIcon()}
      <div class="form-header"><h1>Verifikasi kode</h1><p>Masukkan 6 digit kode yang dikirim ke <strong>${state.email}</strong>.</p></div>
      <form id="otp-form" novalidate>
        <div id="otp-row" style="display:flex;gap:10px;justify-content:space-between;margin-bottom:var(--space-6);">
          ${Array.from({ length: OTP_LEN })
            .map(
              (_, i) =>
                `<input type="text" class="otp-box" data-idx="${i}" inputmode="numeric" maxlength="1" autocomplete="${i === 0 ? 'one-time-code' : 'off'}" aria-label="Digit ${i + 1}" style="${otpBoxStyle}" />`
            )
            .join('')}
        </div>
        <button type="submit" class="btn btn-primary" id="submit-btn">Verifikasi</button>
      </form>
      <div class="auth-footer"><a href="#" id="back-email">Ubah email</a></div>
    `);
    initOtpStep();
  } else if (state.step === 3) {
    app.innerHTML = shell(`
      ${lockIcon()}
      <div class="form-header"><h1>Buat sandi baru</h1><p>Pilih kata sandi yang kuat untuk akun Anda.</p></div>
      <form id="pw-form" novalidate>
        <div class="form-group">
          <label class="form-label" for="password">Kata sandi baru</label>
          <div class="input-wrapper">
            <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <input type="password" id="password" class="form-input" placeholder="Minimal 8 karakter" required autocomplete="new-password">
          </div>
          <!-- Strength meter -->
          <div style="display:flex;gap:6px;margin-top:var(--space-2);">
            <div class="pw-bar" style="flex:1;height:5px;border-radius:999px;background:#E5EEF7;"></div>
            <div class="pw-bar" style="flex:1;height:5px;border-radius:999px;background:#E5EEF7;"></div>
            <div class="pw-bar" style="flex:1;height:5px;border-radius:999px;background:#E5EEF7;"></div>
          </div>
          <p id="pw-label" style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:6px;height:14px;"></p>
        </div>
        <div class="form-group">
          <label class="form-label" for="confirm">Konfirmasi sandi</label>
          <div class="input-wrapper">
            <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <input type="password" id="confirm" class="form-input" placeholder="Ulangi sandi baru" required autocomplete="new-password">
          </div>
        </div>
        <button type="submit" class="btn btn-primary" id="submit-btn">Simpan sandi baru</button>
      </form>
    `);
    initPwStep();
  } else {
    app.innerHTML = shell(`
      <div style="text-align:center;">
        <div style="width:64px;height:64px;border-radius:var(--radius-full);background:#E8F5EC;color:var(--color-success);display:flex;align-items:center;justify-content:center;margin:0 auto var(--space-5);">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
        </div>
        <div class="form-header" style="text-align:center;"><h1>Sandi diperbarui</h1><p>Silakan masuk dengan kata sandi baru Anda.</p></div>
        <a href="/login" class="btn btn-primary" style="text-decoration:none;">Kembali masuk</a>
      </div>
    `);
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

function busy(on: boolean, label: string): void {
  const btn = document.getElementById('submit-btn') as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = on;
  btn.innerHTML = on ? `<div class="spinner"></div> ${label}` : label;
}

function initEmailStep(): void {
  const form = document.getElementById('email-form') as HTMLFormElement | null;
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = (document.getElementById('email') as HTMLInputElement).value.trim().toLowerCase();
    if (!email) return;
    busy(true, 'Mengirim...');
    const result = await apiRequest<Record<string, unknown>>(endpoints.forgotPassword, {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    busy(false, 'Kirim kode');
    if (result.success) {
      state.email = email;
      state.step = 2;
      render();
      // Surface dev_code when the server has no mailer (non-production only).
      const devCode = result.data?.['dev_code'];
      if (devCode) showError(`(Dev) Kode verifikasi: ${String(devCode)}`);
    } else {
      showError(result.error || 'Gagal mengirim kode. Coba lagi.');
    }
  });
}

function initOtpStep(): void {
  const form = document.getElementById('otp-form') as HTMLFormElement | null;
  const backEmail = document.getElementById('back-email');
  const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('.otp-box'));

  boxes.forEach((box, i) => {
    box.addEventListener('focus', () => {
      box.style.borderColor = '#005598';
      box.style.boxShadow = '0 0 0 3px rgba(0,85,152,.13)';
    });
    box.addEventListener('blur', () => {
      box.style.borderColor = '#C8D8EA';
      box.style.boxShadow = 'none';
    });
    box.addEventListener('input', () => {
      box.value = box.value.replace(/\D/g, '').slice(0, 1);
      if (box.value && i < OTP_LEN - 1) boxes[i + 1]!.focus();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && i > 0) boxes[i - 1]!.focus();
    });
    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const digits = (e.clipboardData?.getData('text') ?? '').replace(/\D/g, '').slice(0, OTP_LEN);
      digits.split('').forEach((d, k) => {
        if (boxes[k]) boxes[k]!.value = d;
      });
      boxes[Math.min(digits.length, OTP_LEN - 1)]?.focus();
    });
  });
  boxes[0]?.focus();

  backEmail?.addEventListener('click', (e) => {
    e.preventDefault();
    state.step = 1;
    render();
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = boxes.map((b) => b.value).join('');
    if (code.length !== OTP_LEN) {
      showError('Masukkan 6 digit kode.');
      return;
    }
    busy(true, 'Memverifikasi...');
    const result = await apiRequest<Record<string, unknown>>(endpoints.verifyResetCode, {
      method: 'POST',
      body: JSON.stringify({ email: state.email, code }),
    });
    busy(false, 'Verifikasi');
    if (result.success) {
      state.code = code;
      state.step = 3;
      render();
    } else {
      showError(result.error || 'Kode tidak valid.');
      boxes.forEach((b) => (b.value = ''));
      boxes[0]?.focus();
    }
  });
}

/** Strength score 0..3 from length + character-class variety. */
function scorePassword(pw: string): number {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  const classes =
    Number(/[a-z]/.test(pw)) +
    Number(/[A-Z]/.test(pw)) +
    Number(/\d/.test(pw)) +
    Number(/[^A-Za-z0-9]/.test(pw));
  if (classes >= 3) score++;
  return Math.min(score, 3);
}

function initPwStep(): void {
  const form = document.getElementById('pw-form') as HTMLFormElement | null;
  const pw = document.getElementById('password') as HTMLInputElement | null;
  const bars = Array.from(document.querySelectorAll<HTMLElement>('.pw-bar'));
  const label = document.getElementById('pw-label');
  const meta = [
    { color: '#C0392B', text: 'Lemah' },
    { color: '#B45309', text: 'Sedang' },
    { color: '#15803D', text: 'Kuat' },
  ];

  pw?.addEventListener('input', () => {
    const score = scorePassword(pw.value);
    bars.forEach((bar, i) => {
      bar.style.background =
        pw.value && i < score ? meta[Math.min(score - 1, 2)]!.color : '#E5EEF7';
    });
    if (label) {
      label.textContent = pw.value
        ? `Kekuatan: ${meta[Math.min(score - 1, 2)]?.text ?? 'Lemah'}`
        : '';
    }
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = (document.getElementById('password') as HTMLInputElement).value;
    const confirm = (document.getElementById('confirm') as HTMLInputElement).value;
    if (password.length < 8) {
      showError('Kata sandi minimal 8 karakter.');
      return;
    }
    if (password !== confirm) {
      showError('Konfirmasi sandi tidak cocok.');
      return;
    }
    busy(true, 'Menyimpan...');
    const result = await apiRequest<Record<string, unknown>>(endpoints.resetPassword, {
      method: 'POST',
      body: JSON.stringify({ email: state.email, code: state.code, password }),
    });
    busy(false, 'Simpan sandi baru');
    if (result.success) {
      state.step = 4;
      render();
    } else {
      showError(result.error || 'Gagal menyimpan sandi. Coba lagi.');
    }
  });
}
