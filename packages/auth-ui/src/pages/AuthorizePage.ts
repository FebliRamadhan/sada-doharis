/**
 * Authorize / Consent Page — faithful rebuild of SSO PANRB handoff step #4.
 * Full-bleed split (brand panel + flat form column). Two avatars (app + PANRB)
 * linked by dots, "<App> meminta akses", scope list, Tolak/Izinkan, privacy note.
 * All OAuth logic (silent authorize, client lookup, redirect validation,
 * approve/deny, PKCE passthrough) is preserved.
 */
import { endpoints, apiRequest, setStoredUser, type User, type OAuthClient } from '../api';
import { router, getAppContainer, getQueryParams } from '../router';

interface OAuthParams {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  responseType: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}

// Indonesian scope copy + icon, per the consent mockup. Falls back gracefully.
const SCOPE_ID: Record<string, { text: string; icon: string }> = {
  openid: {
    text: 'Memverifikasi identitas Anda',
    icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#005598" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  },
  profile: {
    text: 'Melihat data profil dasar (nama, NIP, instansi)',
    icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#005598" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  },
  email: {
    text: 'Melihat alamat email instansi',
    icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#005598" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  },
  offline_access: {
    text: 'Mengakses data saat Anda sedang offline',
    icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#005598" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
  },
};
const DEFAULT_SCOPE_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#005598" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';

export async function AuthorizePage(): Promise<void> {
  const app = getAppContainer();
  document.querySelector('.auth-container')?.classList.add('admin-mode');

  app.innerHTML = `
    <div class="sso-auth">
      ${brandPanel()}
      <div class="sso-form" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 40px;position:relative;overflow-y:auto;">
        <div style="width:100%;max-width:400px;">
          <div id="loading-state" style="display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px 0;text-align:center;">
            <div class="spinner spinner-dark spinner-lg"></div>
            <p style="font:500 13px 'Inter';color:#5E7896;">Memuat detail otorisasi...</p>
          </div>
          <div id="auth-content" style="display:none;"></div>
          <div id="error-state" style="display:none;flex-direction:column;align-items:center;gap:14px;padding:30px 0;text-align:center;" role="alert">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#C0392B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <p id="error-message" style="font:500 14px 'Inter';color:#354E6B;">Terjadi kesalahan</p>
            <a href="/login" style="font:600 13px 'Inter';color:#005598;text-decoration:none;">Kembali ke Login</a>
          </div>
        </div>
      </div>
    </div>
  `;

  await init();
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
        <div style="font:400 14px/1.6 'Inter';color:rgba(255,255,255,.72);">Berikan izin akses aplikasi dengan aman melalui Single Sign-On PANRB.</div>
      </div>
      <div style="position:relative;font:500 11px 'Inter';color:rgba(255,255,255,.5);">© 2026 Kementerian PANRB · Republik Indonesia</div>
    </div>
  `;
}

function getOAuthParams(): OAuthParams | null {
  const params = getQueryParams();
  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  if (!clientId || !redirectUri) return null;
  return {
    clientId,
    redirectUri,
    scope: params.get('scope') || 'openid profile',
    state: params.get('state') || '',
    responseType: params.get('response_type') || 'code',
    codeChallenge: params.get('code_challenge') || undefined,
    codeChallengeMethod: params.get('code_challenge_method') || undefined,
  };
}

function showError(message: string): void {
  const loading = document.getElementById('loading-state');
  const content = document.getElementById('auth-content');
  const error = document.getElementById('error-state');
  const msg = document.getElementById('error-message');
  if (loading) loading.style.display = 'none';
  if (content) content.style.display = 'none';
  if (error) error.style.display = 'flex';
  if (msg) msg.textContent = message;
}

function showAuthContent(): void {
  const loading = document.getElementById('loading-state');
  const content = document.getElementById('auth-content');
  const error = document.getElementById('error-state');
  if (loading) loading.style.display = 'none';
  if (content) content.style.display = 'block';
  if (error) error.style.display = 'none';
}

function renderAuthContent(user: User, client: OAuthClient, oauthParams: OAuthParams): void {
  const content = document.getElementById('auth-content');
  if (!content) return;

  const appAbbr = client.name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'AP';
  const scopeRows = oauthParams.scope
    .split(' ')
    .filter(Boolean)
    .map((scope) => {
      const s = SCOPE_ID[scope] ?? { text: `Mengakses ${scope}`, icon: DEFAULT_SCOPE_ICON };
      return `
        <div style="display:flex;gap:12px;align-items:flex-start;">
          <div style="width:24px;height:24px;border-radius:7px;background:#EEF4FB;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${s.icon}</div>
          <div style="font:500 13px/1.4 'Inter';color:#354E6B;">${s.text}</div>
        </div>`;
    })
    .join('');

  content.innerHTML = `
    <!-- App ↔ PANRB avatars -->
    <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:22px;">
      <div style="width:50px;height:50px;border-radius:13px;background:#005598;display:flex;align-items:center;justify-content:center;font:700 14px 'Inter';color:#fff;">${appAbbr}</div>
      <div style="display:flex;gap:4px;">
        <div style="width:5px;height:5px;border-radius:50%;background:#C8D8EA;"></div>
        <div style="width:5px;height:5px;border-radius:50%;background:#C8D8EA;"></div>
        <div style="width:5px;height:5px;border-radius:50%;background:#C8D8EA;"></div>
      </div>
      <div style="width:50px;height:50px;border-radius:50%;border:2.5px solid #01347C;display:flex;align-items:center;justify-content:center;font:800 16px 'Plus Jakarta Sans';color:#01347C;">P</div>
    </div>

    <div style="font:800 22px/1.35 'Plus Jakarta Sans';color:#0D1B2A;text-align:center;margin-bottom:6px;"><b>${client.name}</b> meminta akses</div>
    <div style="font:400 13px 'Inter';color:#5E7896;text-align:center;margin-bottom:24px;">ke akun PANRB Anda (${user.email})</div>

    <div style="font:600 11px 'Inter';color:#9DB2C9;letter-spacing:.6px;margin-bottom:13px;">APLIKASI INI AKAN DAPAT</div>
    <div style="display:flex;flex-direction:column;gap:14px;margin-bottom:28px;">
      ${scopeRows}
    </div>

    <div style="display:flex;gap:12px;">
      <button type="button" id="btn-deny" style="flex:1;height:48px;border:1.5px solid #C8D8EA;border-radius:11px;background:#fff;color:#354E6B;font:700 13px 'Inter';cursor:pointer;transition:background .15s;">Tolak</button>
      <button type="button" id="btn-allow" style="flex:1;height:48px;border:none;border-radius:11px;background:#005598;color:#fff;font:700 13px 'Inter';cursor:pointer;box-shadow:0 6px 16px -6px rgba(0,85,152,.5);transition:background .15s;display:flex;align-items:center;justify-content:center;gap:8px;">Izinkan</button>
    </div>

    <div style="text-align:center;margin-top:18px;font:400 11px 'Inter';color:#9DB2C9;">Dengan mengizinkan, Anda menyetujui pembagian data sesuai kebijakan privasi.</div>

    <div style="text-align:center;margin-top:20px;font:500 12px 'Inter';color:#5E7896;">Masuk sebagai ${user.name} · <a href="/login" style="color:#005598;font-weight:600;text-decoration:none;">Ganti akun</a></div>
  `;

  document.getElementById('btn-deny')?.addEventListener('click', () => handleDeny(oauthParams));
  document.getElementById('btn-allow')?.addEventListener('click', () => handleAllow(oauthParams));

  showAuthContent();
}

function handleDeny(oauthParams: OAuthParams): void {
  const redirectUrl = new URL(oauthParams.redirectUri);
  redirectUrl.searchParams.set('error', 'access_denied');
  redirectUrl.searchParams.set('error_description', 'User denied access');
  if (oauthParams.state) redirectUrl.searchParams.set('state', oauthParams.state);
  window.location.href = redirectUrl.toString();
}

async function handleAllow(oauthParams: OAuthParams): Promise<void> {
  const btnAllow = document.getElementById('btn-allow') as HTMLButtonElement | null;
  const btnDeny = document.getElementById('btn-deny') as HTMLButtonElement | null;
  if (btnAllow) {
    btnAllow.disabled = true;
    btnAllow.innerHTML = '<div class="spinner"></div> Memproses...';
  }
  if (btnDeny) btnDeny.disabled = true;

  try {
    const result = await apiRequest<{ redirect_url: string }>(
      buildAuthorizeQuery(oauthParams, true)
    );
    if (result.success && result.data?.redirect_url) {
      window.location.href = result.data.redirect_url;
    } else {
      throw new Error(result.error || 'Otorisasi gagal');
    }
  } catch {
    showError('Gagal memproses otorisasi. Silakan coba kembali.');
  }
}

function buildAuthorizeQuery(oauthParams: OAuthParams, withConsent = false): string {
  const params = new URLSearchParams({
    response_type: oauthParams.responseType,
    client_id: oauthParams.clientId,
    redirect_uri: oauthParams.redirectUri,
    scope: oauthParams.scope,
  });
  if (oauthParams.state) params.set('state', oauthParams.state);
  if (oauthParams.codeChallenge) params.set('code_challenge', oauthParams.codeChallenge);
  if (oauthParams.codeChallengeMethod)
    params.set('code_challenge_method', oauthParams.codeChallengeMethod);
  if (withConsent) params.set('consent', 'approved');
  return `${endpoints.authorize}?${params.toString()}`;
}

async function init(): Promise<void> {
  const oauthParams = getOAuthParams();
  if (!oauthParams) {
    showError('Permintaan otorisasi tidak valid. Parameter yang diperlukan tidak ditemukan.');
    return;
  }

  try {
    const meResult = await apiRequest<User>(endpoints.me);
    if (!meResult.success || !meResult.data) {
      const returnUrl = window.location.href;
      router.navigate(`/login?return_url=${encodeURIComponent(returnUrl)}`);
      return;
    }

    const user = meResult.data;
    setStoredUser(user);

    // Silent authorize — skip the consent UI when consent is already recorded.
    const silent = await apiRequest<{ redirect_url?: string; needs_consent?: boolean }>(
      buildAuthorizeQuery(oauthParams)
    );
    if (silent.success && silent.data?.redirect_url) {
      window.location.href = silent.data.redirect_url;
      return;
    }

    const clientResult = await apiRequest<OAuthClient>(
      `${endpoints.clients}/${oauthParams.clientId}`
    );
    if (!clientResult.success || !clientResult.data) {
      showError('Aplikasi tidak dikenal. Aplikasi yang meminta akses belum terdaftar.');
      return;
    }

    const client = clientResult.data;
    const isValidRedirect = client.redirectUris.some((uri) =>
      oauthParams.redirectUri.startsWith(uri)
    );
    if (!isValidRedirect) {
      showError(
        'Redirect URI tidak valid. Aplikasi ini tidak memiliki izin untuk alamat pengalihan tersebut.'
      );
      return;
    }

    renderAuthContent(user, client, oauthParams);
  } catch {
    showError('Gagal memuat detail otorisasi. Silakan coba kembali.');
  }
}
