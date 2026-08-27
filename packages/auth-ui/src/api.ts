// API configuration
// In dev (no vite server): set VITE_API_URL=http://localhost:3001 so browser calls auth-service directly.
// In Docker/prod: unset → uses '/api' which nginx proxies to auth-service.
export const API_BASE = (import.meta.env.VITE_API_URL as string) ?? '/api';

// API endpoints
export const endpoints = {
  config: `${API_BASE}/auth/config`,
  sessionToken: `${API_BASE}/auth/session/token`,
  login: `${API_BASE}/auth/login`,
  register: `${API_BASE}/auth/register`,
  forgotPassword: `${API_BASE}/auth/forgot-password`,
  verifyResetCode: `${API_BASE}/auth/verify-reset-code`,
  resetPassword: `${API_BASE}/auth/reset-password`,
  ldapLogin: `${API_BASE}/auth/ldap/login`,
  me: `${API_BASE}/auth/me`,
  logout: `${API_BASE}/auth/logout`,
  authorize: `${API_BASE}/oauth/authorize`,
  token: `${API_BASE}/oauth/token`,
  clients: `${API_BASE}/clients`,
  users: `${API_BASE}/users`,
  userStatus: (id: string) => `${API_BASE}/users/${id}/status`,
  clientLogs: (id: string) => `${API_BASE}/clients/${id}/logs`,
  auditLogs: `${API_BASE}/audit-logs`,
  // MFA (TOTP)
  mfaVerifyLogin: `${API_BASE}/auth/mfa/verify-login`,
  mfaSetup: `${API_BASE}/auth/mfa/setup`,
  mfaEnable: `${API_BASE}/auth/mfa/enable`,
  mfaStatus: `${API_BASE}/auth/mfa/status`,
  mfaDisable: `${API_BASE}/auth/mfa/disable`,
  adminMfaUsers: `${API_BASE}/admin/mfa/users`,
  adminMfaDisable: (id: string) => `${API_BASE}/admin/mfa/users/${id}/disable`,
};

// Storage keys
export const STORAGE_KEYS = {
  accessToken: 'sada_access_token',
  refreshToken: 'sada_refresh_token',
  user: 'sada_user',
};

// Types
export interface User {
  id: string;
  email: string;
  name: string;
  userType: 'INTERNAL' | 'GOVERNMENT' | 'EXTERNAL';
  isAdmin?: boolean;
}

export interface OAuthClient {
  id: string;
  clientId: string;
  name: string;
  redirectUris: string[];
  scopes: string[];
  grants: string[];
  isActive: boolean;
  createdAt: string;
  clientSecret?: string; // only present after create/regenerate
}

export interface AuditLog {
  id: string;
  action: string;
  userId: string | null;
  clientId: string | null;
  ip: string | null;
  userAgent: string | null;
  details: unknown;
  createdAt: string;
}

// meta field returned by apiRequest for paginated endpoints
export interface PaginatedResponse<T> {
  data: T[]; // unused by callers (apiRequest unwraps to r.data directly)
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    /** Whole-result-set counts from the server — never derive these from the page. */
    activeCount?: number;
    inactiveCount?: number;
  };
}

export interface AuthResponse {
  success: boolean;
  data?: {
    accessToken: string;
    refreshToken?: string;
    user: User;
    expiresIn: number;
  };
  error?: string;
}

// Scope descriptions for consent page (SVG icons for professional look)
export const SCOPE_DESCRIPTIONS: Record<
  string,
  { name: string; description: string; iconSvg: string }
> = {
  openid: {
    name: 'OpenID',
    description: 'Verify your identity',
    iconSvg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  },
  profile: {
    name: 'Profile',
    description: 'Access your name and basic profile information',
    iconSvg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  },
  email: {
    name: 'Email',
    description: 'View your email address',
    iconSvg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
  },
  read: {
    name: 'Read Access',
    description: 'Read your data and information',
    iconSvg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  },
  write: {
    name: 'Write Access',
    description: 'Create and modify data on your behalf',
    iconSvg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  },
  offline_access: {
    name: 'Offline Access',
    description: 'Access your data when you are not using the app',
    iconSvg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
  },
};

// Helper functions
export function getStoredToken(): string | null {
  return sessionStorage.getItem(STORAGE_KEYS.accessToken);
}

export function setStoredToken(token: string): void {
  sessionStorage.setItem(STORAGE_KEYS.accessToken, token);
}

export function getStoredUser(): User | null {
  const userStr = sessionStorage.getItem(STORAGE_KEYS.user);
  if (!userStr) return null;
  try {
    return JSON.parse(userStr) as User;
  } catch {
    return null;
  }
}

export function setStoredUser(user: User): void {
  sessionStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
}

export function clearAuthStorage(): void {
  sessionStorage.removeItem(STORAGE_KEYS.accessToken);
  sessionStorage.removeItem(STORAGE_KEYS.refreshToken);
  sessionStorage.removeItem(STORAGE_KEYS.user);
}

export function getUrlParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

export function redirectWithState(url: string): void {
  const params = getUrlParams();
  const state = params.get('state');
  const redirectUri = params.get('redirect_uri');
  const clientId = params.get('client_id');

  const newUrl = new URL(url, window.location.origin);
  if (state) newUrl.searchParams.set('state', state);
  if (redirectUri) newUrl.searchParams.set('redirect_uri', redirectUri);
  if (clientId) newUrl.searchParams.set('client_id', clientId);

  window.location.href = newUrl.toString();
}

export interface ApiResult<T> {
  success: boolean;
  data?: T;
  meta?: PaginatedResponse<unknown>['meta'];
  error?: string;
  /**
   * HTTP status, or 0 when the request never reached the server. Callers need
   * this to tell "your session ended" (401) apart from "the network is down"
   * (0) — those demand opposite reactions, and collapsing both into
   * `success: false` is what let expired sessions sit silently on screen.
   */
  status: number;
}

/**
 * Exchanges the SSO session cookie for a fresh access token.
 *
 * The access token lives 15 minutes; the SSO session lives days. Without this,
 * every authenticated page breaks four times an hour while the user is still
 * perfectly logged in.
 *
 * Returns false when the session itself is gone — that is the point where the
 * caller should send the user to the login page.
 */
async function renewAccessToken(): Promise<boolean> {
  try {
    const response = await fetch(endpoints.sessionToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    if (!response.ok) return false;

    const json = (await response.json()) as {
      data?: { access_token?: string; user?: User };
    };
    const token = json.data?.access_token;
    if (!token) return false;

    setStoredToken(token);
    if (json.data?.user) setStoredUser(json.data.user);
    return true;
  } catch {
    return false;
  }
}

// API helper
export async function apiRequest<T>(
  url: string,
  options: RequestInit = {},
  /** Internal: prevents a renewal loop. Not part of the public contract. */
  isRetry = false
): Promise<ApiResult<T>> {
  try {
    const token = getStoredToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
      // Include the SSO session cookie even when auth-ui and auth-service are
      // on different origins (dev mode: 3002 ↔ 3001).
      credentials: 'include',
    });

    // Read as text first so we can gracefully handle HTML error pages
    // returned by nginx/gateway (502/504/maintenance) instead of crashing
    // with "Unexpected token '<'..." from response.json().
    const contentType = response.headers.get('content-type') ?? '';
    const rawText = await response.text();
    let json: any = null;
    if (contentType.includes('application/json') && rawText) {
      try {
        json = JSON.parse(rawText);
      } catch {
        // fall through — handled below
      }
    }

    // A 401 on a request we sent WITH a token means that token aged out. The
    // SSO session usually has not, so renew once and replay the request before
    // bothering the user. Guarded three ways against looping: only when a token
    // was actually sent (so a wrong password on the login page stays a plain
    // 401), never on the renewal endpoint itself, and never on a retry.
    if (response.status === 401 && token && !isRetry && url !== endpoints.sessionToken) {
      const renewed = await renewAccessToken();
      if (renewed) {
        return apiRequest<T>(url, options, true);
      }
      clearAuthStorage();
    }

    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        error:
          json?.error?.message ||
          json?.message ||
          `Request failed (${response.status} ${response.statusText})`,
      };
    }

    if (!json) {
      return { success: false, status: response.status, error: 'Invalid server response' };
    }

    // Backend wraps all responses: { success: true, data: <payload>, meta?: <pagination> }
    const data = json?.data !== undefined ? json.data : json;
    return { success: true, status: response.status, data, meta: json?.meta };
  } catch (err) {
    // status 0 = never reached the server. Distinct from any HTTP failure:
    // callers must not treat a flaky network as a lost session.
    return {
      success: false,
      status: 0,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}
