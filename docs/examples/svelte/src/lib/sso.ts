/**
 * SADA SSO — OAuth2 PKCE Client Library
 *
 * Copy file ini ke project Anda dan sesuaikan SADA_CONFIG.
 */

// ─── Konfigurasi ─────────────────────────────────────────────────────────────

export interface SadaConfig {
  /** Client ID yang didapat dari admin SADA SSO */
  clientId: string;
  /** Client secret (simpan di server untuk production, bukan browser) */
  clientSecret: string;
  /** URL callback yang sudah didaftarkan di SADA SSO */
  redirectUri: string;
  /** URL authorize page SADA SSO */
  authorizeUrl: string;
  /** URL token endpoint SADA SSO */
  tokenUrl: string;
  /** URL userinfo endpoint */
  userInfoUrl: string;
  /** URL logout endpoint */
  logoutUrl: string;
  /** Scope yang diminta, pisahkan dengan spasi */
  scopes: string;
}

export const SADA_CONFIG: SadaConfig = {
  clientId:     import.meta.env.VITE_SSO_CLIENT_ID     ?? 'ISI_CLIENT_ID',
  clientSecret: import.meta.env.VITE_SSO_CLIENT_SECRET ?? 'ISI_CLIENT_SECRET',
  redirectUri:  import.meta.env.VITE_SSO_REDIRECT_URI  ?? 'http://localhost:5173/callback',
  authorizeUrl: import.meta.env.VITE_SSO_AUTHORIZE_URL ?? 'http://localhost:3002/authorize',
  tokenUrl:     import.meta.env.VITE_SSO_TOKEN_URL     ?? 'http://localhost:3001/oauth/token',
  userInfoUrl:  import.meta.env.VITE_SSO_USERINFO_URL  ?? 'http://localhost:3001/oauth/userinfo',
  logoutUrl:    import.meta.env.VITE_SSO_LOGOUT_URL    ?? 'http://localhost:3001/oauth/logout',
  scopes:       'openid profile email offline_access',
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TokenSet {
  access_token:  string;
  token_type:    string;
  expires_in:    number;
  refresh_token?: string;
  id_token?:     string;
  scope:         string;
  /** Waktu kedaluwarsa (epoch ms), dihitung saat terima token */
  expires_at:    number;
}

export interface UserInfo {
  sub:            string;
  name:           string;
  email:          string;
  email_verified: boolean;
  preferred_username?: string;
}

// ─── PKCE ────────────────────────────────────────────────────────────────────

function base64url(buf: Uint8Array): string {
  let b = '';
  for (const byte of buf) b += String.fromCharCode(byte);
  return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCodeVerifier(): string {
  const buf = new Uint8Array(48);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data   = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64url(new Uint8Array(digest));
}

function generateState(): string {
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

function generateNonce(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

// ─── Login Flow ───────────────────────────────────────────────────────────────

/**
 * Langkah 1 — Arahkan pengguna ke halaman login SADA SSO.
 *
 * Menyimpan code_verifier dan state ke sessionStorage,
 * lalu melakukan redirect ke SADA SSO authorize page.
 */
export async function redirectToLogin(config: SadaConfig = SADA_CONFIG): Promise<void> {
  const verifier   = generateCodeVerifier();
  const challenge  = await generateCodeChallenge(verifier);
  const state      = generateState();
  const nonce      = generateNonce();

  sessionStorage.setItem('sso_code_verifier', verifier);
  sessionStorage.setItem('sso_state', state);

  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             config.clientId,
    redirect_uri:          config.redirectUri,
    scope:                 config.scopes,
    state,
    nonce,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });

  window.location.href = `${config.authorizeUrl}?${params}`;
}

// ─── Callback Handler ─────────────────────────────────────────────────────────

export interface CallbackResult {
  code:  string;
  state: string;
}

/**
 * Langkah 2 — Baca parameter callback dari URL.
 *
 * Panggil ini di halaman /callback.
 * Jika `error` ada, lempar exception.
 */
export function handleCallback(): CallbackResult {
  const params = new URLSearchParams(window.location.search);
  const error  = params.get('error');

  if (error) {
    const desc = params.get('error_description') ?? error;
    throw new Error(`SSO error: ${desc}`);
  }

  const code  = params.get('code');
  const state = params.get('state');

  if (!code || !state) throw new Error('Parameter callback tidak lengkap');

  const storedState = sessionStorage.getItem('sso_state');
  if (state !== storedState)   throw new Error('State mismatch — kemungkinan CSRF');

  return { code, state };
}

// ─── Token Exchange ───────────────────────────────────────────────────────────

/**
 * Langkah 3 — Tukarkan authorization code dengan token.
 */
export async function exchangeCode(
  code: string,
  config: SadaConfig = SADA_CONFIG
): Promise<TokenSet> {
  const verifier = sessionStorage.getItem('sso_code_verifier');
  if (!verifier) throw new Error('Code verifier tidak ditemukan, mulai login ulang');

  const res = await fetch(config.tokenUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type:    'authorization_code',
      client_id:     config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri:  config.redirectUri,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Token exchange gagal (${res.status})`);
  }

  const data: Omit<TokenSet, 'expires_at'> & { expires_in: number } = await res.json();

  // Bersihkan PKCE state
  sessionStorage.removeItem('sso_code_verifier');
  sessionStorage.removeItem('sso_state');

  const tokenSet: TokenSet = {
    ...data,
    expires_at: Date.now() + data.expires_in * 1000,
  };

  saveTokens(tokenSet);
  return tokenSet;
}

// ─── Token Refresh ────────────────────────────────────────────────────────────

/**
 * Perbarui access token menggunakan refresh token.
 */
export async function refreshTokens(config: SadaConfig = SADA_CONFIG): Promise<TokenSet> {
  const tokens = loadTokens();
  if (!tokens?.refresh_token) throw new Error('Tidak ada refresh token');

  const res = await fetch(config.tokenUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type:    'refresh_token',
      client_id:     config.clientId,
      client_secret: config.clientSecret,
      refresh_token: tokens.refresh_token,
    }),
  });

  if (!res.ok) throw new Error('Refresh token gagal — login ulang diperlukan');

  const data = await res.json();
  const newTokens: TokenSet = { ...data, expires_at: Date.now() + data.expires_in * 1000 };
  saveTokens(newTokens);
  return newTokens;
}

// ─── UserInfo ────────────────────────────────────────────────────────────────

/**
 * Ambil profil pengguna dari SADA SSO.
 */
export async function fetchUserInfo(
  accessToken: string,
  config: SadaConfig = SADA_CONFIG
): Promise<UserInfo> {
  const res = await fetch(config.userInfoUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (!res.ok) throw new Error('Gagal mengambil profil pengguna');
  return res.json();
}

// ─── Logout ──────────────────────────────────────────────────────────────────

/**
 * Logout: hapus token lokal dan akhiri sesi di SADA SSO.
 */
export function logout(
  postLogoutRedirectUri?: string,
  config: SadaConfig = SADA_CONFIG
): void {
  const tokens  = loadTokens();
  clearTokens();

  const params = new URLSearchParams();
  if (tokens?.id_token)        params.set('id_token_hint', tokens.id_token);
  if (postLogoutRedirectUri)   params.set('post_logout_redirect_uri', postLogoutRedirectUri);

  window.location.href = `${config.logoutUrl}?${params}`;
}

// ─── Token Storage ────────────────────────────────────────────────────────────

const TOKEN_KEY = 'sso_tokens';

export function saveTokens(tokens: TokenSet): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function loadTokens(): TokenSet | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as TokenSet; } catch { return null; }
}

export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isTokenExpired(tokens: TokenSet, bufferSeconds = 30): boolean {
  return Date.now() >= tokens.expires_at - bufferSeconds * 1000;
}

/**
 * Ambil access token yang valid — otomatis refresh jika hampir kedaluwarsa.
 */
export async function getValidAccessToken(config?: SadaConfig): Promise<string | null> {
  let tokens = loadTokens();
  if (!tokens) return null;

  if (isTokenExpired(tokens)) {
    try {
      tokens = await refreshTokens(config);
    } catch {
      clearTokens();
      return null;
    }
  }

  return tokens.access_token;
}
