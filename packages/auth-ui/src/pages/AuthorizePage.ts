/**
 * Authorize / Consent Page — faithful rebuild of SSO PANRB handoff step #4.
 * Full-bleed split (brand panel + flat form column). Two avatars (app + PANRB)
 * linked by dots, "<App> meminta akses", scope list, Tolak/Izinkan, privacy note.
 * All OAuth logic (silent authorize, client lookup, redirect validation,
 * approve/deny, PKCE passthrough) is preserved.
 */
import { endpoints, apiRequest, setStoredUser, type User, type OAuthClient } from '../api';
import { router, getAppContainer, getQueryParams } from '../router';
import { brandPanel, MOBILE_LOGO } from '../shell';

interface OAuthParams {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  responseType: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  /**
   * Wajib ikut. Klien OIDC mencocokkan nonce pada id_token dengan yang ia
   * kirim; bila hilang di perjalanan lewat layar persetujuan, id_token lahir
   * tanpa nonce dan klien menolaknya — tepat setelah pengguna menyetujui.
   */
  nonce?: string;
}

// Indonesian scope copy + icon, per the consent mockup. Falls back gracefully.
const SCOPE_ID: Record<string, { text: string; icon: string }> = {
  openid: {
    text: 'Memverifikasi identitas Anda',
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  },
  profile: {
    text: 'Melihat data profil dasar (nama, NIP, instansi)',
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  },
  email: {
    text: 'Melihat alamat email instansi',
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  },
  offline_access: {
    text: 'Mengakses data saat Anda sedang offline',
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
  },
};
const DEFAULT_SCOPE_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';

export async function AuthorizePage(): Promise<void> {
  const app = getAppContainer();
  document.querySelector('.auth-container')?.classList.add('admin-mode');

  app.innerHTML = `
    <div class="sso-auth">
      ${brandPanel('Berikan izin akses aplikasi dengan aman melalui Single Sign-On PANRB.')}
      <div class="sso-form">
        ${MOBILE_LOGO}
        <div class="sso-form-body">
          <div id="loading-state" class="auth-state" role="status">
            <div class="spinner spinner-dark spinner-lg"></div>
            <p>Memuat detail otorisasi…</p>
          </div>
          <div id="auth-content" style="display:none;"></div>
          <div id="error-state" class="auth-state is-error" style="display:none;" role="alert">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <p id="error-message">Terjadi kesalahan</p>
            <a class="text-link" href="/login">Kembali ke login</a>
          </div>
        </div>
      </div>
    </div>
  `;

  await init();
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
    nonce: params.get('nonce') || undefined,
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

  const appAbbr =
    client.name
      .replace(/[^A-Za-z]/g, '')
      .slice(0, 2)
      .toUpperCase() || 'AP';
  const scopeRows = oauthParams.scope
    .split(' ')
    .filter(Boolean)
    .map((scope) => {
      const s = SCOPE_ID[scope] ?? { text: `Mengakses ${esc(scope)}`, icon: DEFAULT_SCOPE_ICON };
      return `<li class="consent-scope"><span class="consent-scope-icon">${s.icon}</span><span>${s.text}</span></li>`;
    })
    .join('');

  content.innerHTML = `
    <div class="consent-head">
      <span class="consent-mono" aria-hidden="true">${esc(appAbbr)}</span>
      <div class="form-header">
        <h1>${esc(client.name)} meminta akses</h1>
        <p>ke akun PANRB Anda (${esc(user.email)})</p>
      </div>
    </div>

    <p class="consent-lead">Aplikasi ini akan dapat:</p>
    <ul class="consent-scopes">
      ${scopeRows}
    </ul>

    <div class="consent-actions">
      <button type="button" id="btn-deny" class="btn btn-deny">Tolak</button>
      <button type="button" id="btn-allow" class="btn btn-allow">Izinkan</button>
    </div>

    <p class="consent-note">Dengan mengizinkan, Anda menyetujui pembagian data sesuai kebijakan privasi.</p>

    <p class="consent-who"><span>Masuk sebagai ${esc(user.name)}</span><a class="text-link" href="/login">Ganti akun</a></p>
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
    btnAllow.innerHTML = '<div class="spinner"></div> Memproses…';
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
  if (oauthParams.nonce) params.set('nonce', oauthParams.nonce);
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

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
