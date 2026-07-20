/**
 * MFA Verify Page — second login step for users with MFA enabled.
 * Full-bleed split (brand panel + centered OTP column) per SSO PANRB handoff
 * step #2 "Verifikasi kode": envelope icon, 6-box OTP (auto-advance), verify
 * button, plus a backup-code fallback. (Our factor is TOTP, not email.)
 */
import { endpoints, apiRequest, setStoredToken, setStoredUser, type User } from '../api';
import { router, getAppContainer, getQueryParams } from '../router';

export const MFA_TICKET_KEY = 'sada_mfa_ticket';
// OAuth return URL is captured at /login but lost when we navigate to the MFA
// pages (no query carry-over), so stash it alongside the ticket and restore it
// after MFA completes — otherwise the user never returns to the originating app.
export const MFA_RETURN_URL_KEY = 'sada_mfa_return_url';

const OTP_LEN = 6;

const otpBoxStyle =
  'width:48px;height:58px;border:1.5px solid #C8D8EA;border-radius:11px;text-align:center;' +
  "font:700 22px 'Inter';color:#0D1B2A;background:#fff;outline:none;transition:border-color .15s,box-shadow .15s";

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
      ${brandPanel()}
      <div class="sso-form" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 40px;position:relative;overflow-y:auto;">
        <div style="width:100%;max-width:390px;text-align:center;">
          <div style="width:56px;height:56px;border-radius:15px;background:#EEF4FB;display:flex;align-items:center;justify-content:center;margin:0 auto 22px;">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#005598" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <div style="font:800 24px 'Plus Jakarta Sans';color:#0D1B2A;margin-bottom:8px;">Verifikasi kode</div>
          <div style="font:400 14px/1.5 'Inter';color:#5E7896;margin-bottom:30px;">Masukkan 6 digit kode dari aplikasi <b style="color:#354E6B;">authenticator</b> Anda.</div>

          <div id="error-alert" class="alert alert-error" role="alert" aria-live="assertive" style="display:none;text-align:left;margin-bottom:18px;">
            <svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span id="error-message"></span>
          </div>

          <form id="mfa-form" novalidate>
            <div id="otp-row" style="display:flex;gap:9px;justify-content:center;margin-bottom:28px;">
              ${Array.from({ length: OTP_LEN })
                .map(
                  (_, i) =>
                    `<input type="text" class="otp-box" data-idx="${i}" inputmode="numeric" maxlength="1" autocomplete="${i === 0 ? 'one-time-code' : 'off'}" aria-label="Digit ${i + 1}" style="${otpBoxStyle}" />`
                )
                .join('')}
            </div>

            <div class="form-group" id="backup-group" style="display:none;text-align:left;margin-bottom:20px;">
              <label class="form-label" for="backup-code">Kode Cadangan</label>
              <div class="input-wrapper">
                <input type="text" id="backup-code" class="form-input" placeholder="XXXXX-XXXXX" autocomplete="off" style="padding-left:var(--space-4);letter-spacing:.12em;">
              </div>
            </div>

            <button type="submit" id="submit-btn" style="width:100%;height:50px;border:none;border-radius:11px;background:#005598;color:#fff;font:700 14px 'Inter';cursor:pointer;box-shadow:0 6px 16px -6px rgba(0,85,152,.5);transition:background .15s;margin-bottom:18px;">Verifikasi</button>
          </form>

          <div style="font:500 13px 'Inter';color:#5E7896;">
            <a href="#" id="use-backup" style="color:#005598;font-weight:600;text-decoration:none;">Gunakan kode cadangan</a>
            &nbsp;·&nbsp;
            <a href="/login" id="back-login" style="color:#5E7896;text-decoration:none;">Kembali ke login</a>
          </div>
        </div>
      </div>
    </div>
  `;

  initForm(ticket);
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
        <div style="font:400 14px/1.6 'Inter';color:rgba(255,255,255,.72);">Verifikasi 2 langkah menjaga akun PANRB Anda tetap aman.</div>
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

function finishLogin(data: Record<string, unknown>): void {
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
  if (returnUrl) {
    window.location.href = returnUrl;
  } else {
    router.navigate('/');
  }
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
    submitBtn.innerHTML = '<div class="spinner"></div> Memverifikasi...';

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
