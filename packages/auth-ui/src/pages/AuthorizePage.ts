/**
 * Authorize Page Component
 * OAuth consent/authorization screen
 */
import {
    endpoints,
    apiRequest,
    getStoredToken,
    getStoredUser,
    SCOPE_DESCRIPTIONS,
    type User,
    type OAuthClient,
} from '../api';
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

export async function AuthorizePage(): Promise<void> {
    const app = getAppContainer();

    // Initial loading state
    app.innerHTML = `
        <div class="auth-card">
            <div class="brand">
                <div class="brand-logo">S</div>
                <h1>Authorize</h1>
                <p id="auth-description">An application wants to access your account</p>
            </div>
            <div id="loading-state" class="loading-state">
                <div class="spinner spinner-lg"></div>
                <p>Loading authorization details...</p>
            </div>
            <div id="auth-content" style="display: none;"></div>
            <div id="error-state" class="loading-state" style="display: none;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)"
                    stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <p id="error-message">Something went wrong</p>
                <a href="/login" class="btn btn-secondary" style="width: auto; margin-top: var(--space-4);">
                    Back to Login
                </a>
            </div>
            <div class="security-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                    stroke-linejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <span>Your data is protected</span>
            </div>
        </div>
    `;

    await init();
}

function getOAuthParams(): OAuthParams | null {
    const params = getQueryParams();
    const clientId = params.get('client_id');
    const redirectUri = params.get('redirect_uri');

    if (!clientId || !redirectUri) {
        return null;
    }

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
    const loadingState = document.getElementById('loading-state');
    const authContent = document.getElementById('auth-content');
    const errorState = document.getElementById('error-state');
    const errorMessage = document.getElementById('error-message');

    if (loadingState) loadingState.style.display = 'none';
    if (authContent) authContent.style.display = 'none';
    if (errorState) errorState.style.display = 'flex';
    if (errorMessage) errorMessage.textContent = message;
}

function showAuthContent(): void {
    const loadingState = document.getElementById('loading-state');
    const authContent = document.getElementById('auth-content');
    const errorState = document.getElementById('error-state');

    if (loadingState) loadingState.style.display = 'none';
    if (authContent) authContent.style.display = 'block';
    if (errorState) errorState.style.display = 'none';
}

function renderAuthContent(user: User, client: OAuthClient, oauthParams: OAuthParams): void {
    const authContent = document.getElementById('auth-content');
    if (!authContent) return;

    const scopes = oauthParams.scope.split(' ');
    const defaultIconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

    const scopeItems = scopes.map(scope => {
        const scopeInfo = SCOPE_DESCRIPTIONS[scope] || {
            name: scope,
            description: `Access to ${scope}`,
            iconSvg: defaultIconSvg,
        };
        return `
            <li class="scope-item">
                <div class="scope-icon">${scopeInfo.iconSvg}</div>
                <div class="scope-info">
                    <h4>${scopeInfo.name}</h4>
                    <p>${scopeInfo.description}</p>
                </div>
            </li>
        `;
    }).join('');

    let appDomain = oauthParams.redirectUri;
    try {
        const url = new URL(oauthParams.redirectUri);
        appDomain = url.hostname;
    } catch {
        // Ignore
    }

    authContent.innerHTML = `
        <!-- Current User -->
        <div class="user-card">
            <div class="user-avatar">${user.name.charAt(0).toUpperCase()}</div>
            <div class="user-info">
                <h4>${user.name}</h4>
                <p>${user.email}</p>
            </div>
            <a href="/login" class="switch-link">Switch</a>
        </div>

        <!-- Application Info -->
        <div class="app-info">
            <div class="app-icon">${client.name.charAt(0).toUpperCase()}</div>
            <div class="app-details">
                <h3>${client.name}</h3>
                <p>${appDomain}</p>
            </div>
        </div>

        <!-- Permissions -->
        <p style="font-size: var(--font-sm); color: var(--color-text-secondary); margin-bottom: var(--space-4);">
            This application will be able to:
        </p>

        <ul class="scope-list">
            ${scopeItems}
        </ul>

        <!-- Actions -->
        <div class="consent-actions">
            <button type="button" class="btn btn-deny" id="btn-deny">Deny</button>
            <button type="button" class="btn btn-allow" id="btn-allow">Allow</button>
        </div>

        <div class="auth-footer">
            <p>By clicking Allow, you authorize this application to access your data.</p>
        </div>
    `;

    // Attach event handlers
    document.getElementById('btn-deny')?.addEventListener('click', () => handleDeny(oauthParams));
    document.getElementById('btn-allow')?.addEventListener('click', () => handleAllow(oauthParams));

    showAuthContent();
}

function handleDeny(oauthParams: OAuthParams): void {
    const redirectUrl = new URL(oauthParams.redirectUri);
    redirectUrl.searchParams.set('error', 'access_denied');
    redirectUrl.searchParams.set('error_description', 'User denied access');
    if (oauthParams.state) {
        redirectUrl.searchParams.set('state', oauthParams.state);
    }
    window.location.href = redirectUrl.toString();
}

async function handleAllow(oauthParams: OAuthParams): Promise<void> {
    const btnAllow = document.getElementById('btn-allow') as HTMLButtonElement;
    const btnDeny = document.getElementById('btn-deny') as HTMLButtonElement;

    if (btnAllow) {
        btnAllow.disabled = true;
        btnAllow.innerHTML = '<div class="spinner"></div> Authorizing...';
    }
    if (btnDeny) btnDeny.disabled = true;

    try {
        const authorizeUrl = new URL(endpoints.authorize, window.location.origin);
        authorizeUrl.searchParams.set('client_id', oauthParams.clientId);
        authorizeUrl.searchParams.set('redirect_uri', oauthParams.redirectUri);
        authorizeUrl.searchParams.set('scope', oauthParams.scope);
        authorizeUrl.searchParams.set('response_type', oauthParams.responseType);
        if (oauthParams.state) authorizeUrl.searchParams.set('state', oauthParams.state);
        if (oauthParams.codeChallenge) authorizeUrl.searchParams.set('code_challenge', oauthParams.codeChallenge);
        if (oauthParams.codeChallengeMethod) authorizeUrl.searchParams.set('code_challenge_method', oauthParams.codeChallengeMethod);
        authorizeUrl.searchParams.set('consent', 'approved');

        window.location.href = authorizeUrl.toString();
    } catch {
        showError('Failed to authorize. Please try again.');
        if (btnAllow) {
            btnAllow.disabled = false;
            btnAllow.innerHTML = 'Allow Access';
        }
        if (btnDeny) btnDeny.disabled = false;
    }
}

async function init(): Promise<void> {
    const oauthParams = getOAuthParams();
    if (!oauthParams) {
        showError('Invalid authorization request. Missing required parameters.');
        return;
    }

    const token = getStoredToken();
    const storedUser = getStoredUser();

    if (!token || !storedUser) {
        const returnUrl = window.location.href;
        router.navigate(`/login?return_url=${encodeURIComponent(returnUrl)}`);
        return;
    }

    try {
        const result = await apiRequest<{ user: User }>(endpoints.me);

        if (!result.success) {
            const returnUrl = window.location.href;
            router.navigate(`/login?return_url=${encodeURIComponent(returnUrl)}`);
            return;
        }

        const user = result.data?.user || storedUser;

        const clientResult = await apiRequest<OAuthClient>(
            `${endpoints.clients}/${oauthParams.clientId}`
        );

        if (!clientResult.success || !clientResult.data) {
            showError('Unknown application. The application requesting access is not registered.');
            return;
        }

        const client = clientResult.data;

        const isValidRedirect = client.redirectUris.some(
            (uri) => oauthParams.redirectUri.startsWith(uri)
        );

        if (!isValidRedirect) {
            showError('Invalid redirect URI. This application is not authorized to use this redirect URI.');
            return;
        }

        renderAuthContent(user, client, oauthParams);
    } catch {
        showError('Failed to load authorization details. Please try again.');
    }
}
