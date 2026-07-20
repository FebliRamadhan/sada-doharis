/**
 * Home (`/`) — thin router landing.
 * Resolves the current user, then redirects:
 *   - not signed in        → /login
 *   - signed in (+ default app configured, non-admin) → that app
 *   - otherwise            → /portal (SSO app launcher)
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
  app.innerHTML = `
    <div class="auth-card">
      <div class="loading-state">
        <div class="spinner spinner-dark spinner-lg"></div>
        <p>Memuat...</p>
      </div>
    </div>`;

  // Keep the user here when mid-OAuth (callback/error/authorize hand-off on /).
  const params = new URLSearchParams(window.location.search);
  const isOauthFlow = params.has('code') || params.has('error') || params.has('client_id');

  const token = getStoredToken();
  const storedUser = getStoredUser();

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

  // Anonymous → login.
  if (!token || !user) {
    if (token && !user) clearAuthStorage();
    router.navigate('/login', true);
    return;
  }

  // Authenticated non-admin: bounce to the default app when configured.
  if (DEFAULT_APP_URL && !isOauthFlow && !user.isAdmin) {
    window.location.replace(DEFAULT_APP_URL);
    return;
  }

  // Otherwise land on the SSO Portal (app launcher).
  router.navigate('/portal', true);
}
