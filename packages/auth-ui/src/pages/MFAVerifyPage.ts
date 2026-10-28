/**
 * MFA Verify Page — second login step for users with MFA enabled.
 * Full-bleed split (brand panel + centered OTP column) per SSO PANRB handoff
 * step #2 "Verifikasi kode": envelope icon, 6-box OTP (auto-advance), verify
 * button, plus a backup-code fallback. (Our factor is TOTP, not email.)
 */
import { endpoints, apiRequest, setStoredToken, setStoredUser, type User } from '../api';
import { router, getAppContainer, getQueryParams } from '../router';
import { continueAfterLogin, redirectIfPasswordChangeRequired } from '../password-gate';
import { brandPanel, MOBILE_LOGO } from '../shell';

export const MFA_TICKET_KEY = 'sada_mfa_ticket';
// OAuth return URL is captured at /login but lost when we navigate to the MFA
// pages (no query carry-over), so stash it alongside the ticket and restore it
// after MFA completes — otherwise the user never returns to the originating app.
export const MFA_RETURN_URL_KEY = 'sada_mfa_return_url';

const OTP_LEN = 6;

export async function MFAVerifyPage(): Promise<void> {
  const app = getAppContainer();
  const ticket = sessionStorage.getItem(MFA_TICKET_KEY);

  if (!ticket) {
    router.navigate('/login', true);
    return;
  }

  document.querySelector('.auth-container')?.classList.add('admin-mode');

  app.innerHTML = `
    <div class="sso-auth">
      ${brandPanel('Verifikasi 2 langkah menjaga akun PANRB Anda tetap aman.')}
      <div class="sso-form">
        ${MOBILE_LOGO}
        <div class="sso-form-body">
          <div class="form-header">
            <h1>Verifikasi kode</h1>
            <p>Masukkan 6 digit kode dari aplikasi authenticator Anda.</p>
          </div>

          <div id="error-alert" class="alert alert-error" role="alert" aria-live="assertive" style="display:none;">
            <svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span id="error-message"></span>
          </div>

          <form id="mfa-form" novalidate>
            <div id="otp-row" class="otp-row" role="group" aria-label="Kode verifikasi 6 digit">
              ${Array.from({ length: OTP_LEN })
                .map(
                  (_, i) =>
                    `<input type="text" class="otp-box" data-idx="${i}" inputmode="numeric" maxlength="1" autocomplete="${i === 0 ? 'one-time-code' : 'off'}" aria-label="Digit ${i + 1}" />`
                )
                .join('')}
            </div>

            <div class="form-group" id="backup-group" style="display:none;">
              <label class="form-label" for="backup-code">Kode cadangan</label>
              <input type="text" id="backup-code" class="form-input is-plain is-code" placeholder="XXXXX-XXXXX" autocomplete="off">
            </div>

            <button type="submit" id="submit-btn" class="btn btn-primary">Verifikasi</button>
          </form>

          <div class="auth-links">
            <a class="text-link" href="#" id="use-backup">Gunakan kode cadangan</a>
            <a class="text-link is-quiet" href="/login" id="back-login">Kembali ke login</a>
          </div>
        </div>
      </div>
    </div>
  `;

  initForm(ticket);
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

function finishLogin(data: Record<string, unknown>): void {
  const pendingReturnUrl =
    getQueryParams().get('return_url') ?? sessionStorage.getItem(MFA_RETURN_URL_KEY);
  if (redirectIfPasswordChangeRequired(data, pendingReturnUrl)) {
    sessionStorage.removeItem(MFA_TICKET_KEY);
    sessionStorage.removeItem(MFA_RETURN_URL_KEY);
    return;
  }

  const token = String(data['access_token'] ?? '');
  const user = data['user'] as User | undefined;
  if (!token || !user) {
    showError('Respons tidak valid dari server.');
    return;
  }
  setStoredToken(token);
  setStoredUser(user);
  sessionStorage.removeItem(MFA_TICKET_KEY);

  const returnUrl =
    getQueryParams().get('return_url') ?? sessionStorage.getItem(MFA_RETURN_URL_KEY);
  sessionStorage.removeItem(MFA_RETURN_URL_KEY);
  continueAfterLogin(user, returnUrl);
}

function initForm(ticket: string): void {
  const form = document.getElementById('mfa-form') as HTMLFormElement | null;
  const useBackup = document.getElementById('use-backup');
  const otpRow = document.getElementById('otp-row');
  const backupGroup = document.getElementById('backup-group');
  const backupInput = document.getElementById('backup-code') as HTMLInputElement | null;
  const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('.otp-box'));

  let backupMode = false;

  boxes.forEach((box, i) => {
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

  useBackup?.addEventListener('click', (e) => {
    e.preventDefault();
    backupMode = !backupMode;
    if (otpRow) otpRow.style.display = backupMode ? 'none' : 'flex';
    if (backupGroup) backupGroup.style.display = backupMode ? 'block' : 'none';
    (useBackup as HTMLElement).textContent = backupMode
      ? 'Gunakan kode authenticator'
      : 'Gunakan kode cadangan';
    if (backupMode) backupInput?.focus();
    else boxes[0]?.focus();
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    const code = backupMode
      ? (backupInput?.value.trim() ?? '')
      : boxes.map((b) => b.value).join('');

    const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="spinner"></div> Memverifikasi…';

    try {
      const result = await apiRequest<Record<string, unknown>>(endpoints.mfaVerifyLogin, {
        method: 'POST',
        body: JSON.stringify({ ticket, code }),
      });
      if (result.success && result.data) {
        finishLogin(result.data);
      } else {
        showError(result.error || 'Kode tidak valid.');
        if (!backupMode) {
          boxes.forEach((b) => (b.value = ''));
          boxes[0]?.focus();
        }
        if ((result.error || '').toLowerCase().includes('sign in again')) {
          sessionStorage.removeItem(MFA_TICKET_KEY);
          setTimeout(() => router.navigate('/login', true), 1500);
        }
      }
    } catch {
      showError('Terjadi kesalahan jaringan. Silakan coba kembali.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Verifikasi';
    }
  });
}
