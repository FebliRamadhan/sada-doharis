// API configuration
export const API_BASE = '/api';

// API endpoints
export const endpoints = {
    login: `${API_BASE}/auth/login`,
    ldapLogin: `${API_BASE}/auth/ldap/login`,
    me: `${API_BASE}/auth/me`,
    logout: `${API_BASE}/auth/logout`,
    authorize: `${API_BASE}/oauth/authorize`,
    token: `${API_BASE}/oauth/token`,
    clients: `${API_BASE}/clients`,
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
}

export interface OAuthClient {
    id: string;
    name: string;
    redirectUris: string[];
    scopes: string[];
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
export const SCOPE_DESCRIPTIONS: Record<string, { name: string; description: string; iconSvg: string }> = {
    'openid': {
        name: 'OpenID',
        description: 'Verify your identity',
        iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    },
    'profile': {
        name: 'Profile',
        description: 'Access your name and basic profile information',
        iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    },
    'email': {
        name: 'Email',
        description: 'View your email address',
        iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    },
    'read': {
        name: 'Read Access',
        description: 'Read your data and information',
        iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    },
    'write': {
        name: 'Write Access',
        description: 'Create and modify data on your behalf',
        iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    },
    'offline_access': {
        name: 'Offline Access',
        description: 'Access your data when you are not using the app',
        iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
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

// API helper
export async function apiRequest<T>(
    url: string,
    options: RequestInit = {}
): Promise<{ success: boolean; data?: T; error?: string }> {
    try {
        const token = getStoredToken();
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(options.headers as Record<string, string> || {}),
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(url, {
            ...options,
            headers,
        });

        const json = await response.json();

        if (!response.ok) {
            return {
                success: false,
                error: json?.error?.message || json?.message || 'Request failed',
            };
        }

        // Backend wraps all responses: { success: true, data: <payload> }
        // Unwrap so callers receive the payload directly
        const data = json?.data !== undefined ? json.data : json;
        return { success: true, data };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Network error',
        };
    }
}
