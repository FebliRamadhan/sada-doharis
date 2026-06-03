/**
 * Home Page Component
 */
import {
    endpoints,
    apiRequest,
    getStoredToken,
    getStoredUser,
    clearAuthStorage,
    type User,
} from '../api';
import { router, getAppContainer } from '../router';

const DEFAULT_APP_URL = (import.meta.env.VITE_DEFAULT_APP_URL as string | undefined)?.trim();

export async function HomePage(): Promise<void> {
    const app = getAppContainer();

    // Initial loading state
    app.innerHTML = `
        <div class="auth-card">
            <div class="brand">
                <div class="brand-logo">S</div>
                <h1>SADA SSO</h1>
                <p>Single Sign-On Portal</p>
            </div>
            <div class="loading-state">
                <div class="spinner spinner-lg"></div>
                <p>Checking authentication...</p>
            </div>
        </div>
    `;

    // Skip the default-app redirect when the URL is mid-flow (OAuth callback,
    // explicit error, or an authorize hand-off that landed on /).
    const params = new URLSearchParams(window.location.search);
    const isOauthFlow = params.has('code') || params.has('error') || params.has('client_id');

    const token = getStoredToken();
    const storedUser = getStoredUser();

    // Resolve the freshest user we can — Bearer token first, fall back to
    // session cookie via /auth/me, then to whatever's in storage.
    let user: User | null = null;
    if (token) {
        try {
            const result = await apiRequest<User>(endpoints.me);
            if (result.success && result.data) user = result.data;
        } catch {
            // ignore — fall back below
        }
    }
    if (!user) user = storedUser;

    // Anonymous users see the login page on the portal itself.
    if (!token || !user) {
        if (token && !user) clearAuthStorage();
        showUnauthenticated(app);
        return;
    }

    // Authenticated non-admin: bounce to the default app (already signed in
    // via SSO session cookie). Admins stay on the portal to reach /admin.
    // OAuth flow params keep the user here regardless.
    if (DEFAULT_APP_URL && !isOauthFlow && !user.isAdmin) {
        window.location.replace(DEFAULT_APP_URL);
        return;
    }

    showAuthenticated(app, user);
}

function showAuthenticated(app: HTMLElement, user: User): void {
    app.innerHTML = `
        <div class="auth-card">
            <div class="brand">
                <div class="brand-logo">S</div>
                <h1>SADA SSO</h1>
                <p>Single Sign-On Portal</p>
            </div>

            <div class="user-card">
                <div class="user-avatar">${user.name.charAt(0).toUpperCase()}</div>
                <div class="user-info">
                    <h4>${user.name}</h4>
                    <p>${user.email}</p>
                </div>
            </div>

            <p style="font-size: var(--font-sm); color: var(--color-text-secondary); margin-bottom: var(--space-5);">
                You are currently signed in.
            </p>

            <div style="display: flex; flex-direction: column; gap: var(--space-3);">
                ${user.isAdmin ? `<a href="/admin" class="btn btn-secondary">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="2" y="3" width="20" height="14" rx="2"/>
                        <path d="M8 21h8M12 17v4"/>
                    </svg>
                    Admin Panel
                </a>` : ''}
                <button type="button" class="btn btn-secondary" id="logout-btn">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    Sign Out
                </button>
            </div>

            <div class="security-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                    stroke-linejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <span>Enterprise-grade security</span>
            </div>
        </div>
    `;

    // Attach logout handler
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
}

function showUnauthenticated(app: HTMLElement): void {
    app.innerHTML = `
        <div class="auth-card">
            <div class="brand">
                <div class="brand-logo">S</div>
                <h1>SADA SSO</h1>
                <p>Single Sign-On Portal</p>
            </div>

            <p style="font-size: var(--font-sm); color: var(--color-text-secondary); text-align: center; margin-bottom: var(--space-6);">
                Sign in to access all SADA services with a single account.
            </p>

            <a href="/login" class="btn btn-primary">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Sign In
            </a>

            <div class="security-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                    stroke-linejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <span>Enterprise-grade security</span>
            </div>
        </div>
    `;
}

async function handleLogout(): Promise<void> {
    const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;
    if (logoutBtn) {
        logoutBtn.disabled = true;
        logoutBtn.innerHTML = '<div class="spinner"></div> Signing out...';
    }

    try {
        await apiRequest(endpoints.logout, { method: 'POST' });
    } catch {
        // Ignore logout errors
    }

    clearAuthStorage();
    router.navigate('/login');
}
