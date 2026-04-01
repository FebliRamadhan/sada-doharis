/**
 * SADA SSO — Svelte Auth Store
 *
 * Gunakan store ini untuk mengakses status login
 * dari komponen mana pun di aplikasi.
 */
import { writable, derived, get } from 'svelte/store';
import {
  loadTokens,
  clearTokens,
  fetchUserInfo,
  redirectToLogin,
  logout as ssoLogout,
  getValidAccessToken,
  type UserInfo,
  type TokenSet,
} from './sso';

// ─── State ────────────────────────────────────────────────────────────────────

const _user    = writable<UserInfo | null>(null);
const _tokens  = writable<TokenSet | null>(null);
const _loading = writable<boolean>(true);

// ─── Derived (read-only) ──────────────────────────────────────────────────────

export const user            = derived(_user,    $u => $u);
export const tokens          = derived(_tokens,  $t => $t);
export const loading         = derived(_loading, $l => $l);
export const isAuthenticated = derived(_user,    $u => !!$u);

// ─── Actions ──────────────────────────────────────────────────────────────────

/** Inisialisasi — panggil sekali di root layout */
export async function initAuth(): Promise<void> {
  const stored = loadTokens();
  if (!stored) { _loading.set(false); return; }

  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) { _loading.set(false); return; }

    const userInfo = await fetchUserInfo(accessToken);
    _tokens.set(stored);
    _user.set(userInfo);
  } catch {
    clearTokens();
  } finally {
    _loading.set(false);
  }
}

/** Mulai login — redirect ke SADA SSO */
export async function login(): Promise<void> {
  await redirectToLogin();
}

/** Logout — hapus token + akhiri sesi di SADA SSO */
export function logout(): void {
  ssoLogout(window.location.origin + '/login');
  _user.set(null);
  _tokens.set(null);
}

/** Ambil access token yang valid, auto-refresh jika perlu */
export async function getToken(): Promise<string | null> {
  return getValidAccessToken();
}

/**
 * Buat fetch helper yang otomatis menyertakan Bearer token.
 *
 * @example
 * const res = await authFetch('/api/data');
 * const data = await res.json();
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

/** Set user dan token setelah exchange code berhasil */
export function setSession(tokenSet: TokenSet, userInfo: UserInfo): void {
  _tokens.set(tokenSet);
  _user.set(userInfo);
}
