import './style.css';
import {
    endpoints,
    apiRequest,
    getStoredToken,
    getStoredUser,
    getUrlParams,
    SCOPE_DESCRIPTIONS,
    type User,
    type OAuthClient,
} from './api';

// DOM Elements
const loadingState = document.getElementById('loading-state') as HTMLElement;
const authContent = document.getElementById('auth-content') as HTMLElement;
const errorState = document.getElementById('error-state') as HTMLElement;
const errorMessage = document.getElementById('error-message') as HTMLElement;

const userAvatar = document.getElementById('user-avatar') as HTMLElement;
const userName = document.getElementById('user-name') as HTMLElement;
const userEmail = document.getElementById('user-email') as HTMLElement;

const appIcon = document.getElementById('app-icon') as HTMLElement;
const appName = document.getElementById('app-name') as HTMLElement;
const appUri = document.getElementById('app-uri') as HTMLElement;
const scopeList = document.getElementById('scope-list') as HTMLElement;

const btnDeny = document.getElementById('btn-deny') as HTMLButtonElement;
const btnAllow = document.getElementById('btn-allow') as HTMLButtonElement;

// Get OAuth params from URL
interface OAuthParams {
    clientId: string;
    redirectUri: string;
    scope: string;
    state: string;
    responseType: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
}

function getOAuthParams(): OAuthParams | null {
    const params = getUrlParams();
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

// Show error state
function showError(message: string): void {
    loadingState.style.display = 'none';
    authContent.style.display = 'none';
    errorState.style.display = 'flex';
    errorMessage.textContent = message;
}

// Show auth content
function showAuthContent(): void {
    loadingState.style.display = 'none';
    authContent.style.display = 'block';
    errorState.style.display = 'none';
}

// Populate user info
function populateUserInfo(user: User): void {
    userAvatar.textContent = user.name.charAt(0).toUpperCase();
    userName.textContent = user.name;
    userEmail.textContent = user.email;
}

// Populate client info
function populateClientInfo(client: OAuthClient, redirectUri: string): void {
    appIcon.textContent = client.name.charAt(0).toUpperCase();
    appName.textContent = client.name;

    // Show domain only for security
    try {
        const url = new URL(redirectUri);
        appUri.textContent = url.hostname;
    } catch {
        appUri.textContent = redirectUri;
    }
}

// Populate scopes
function populateScopes(scopes: string[]): void {
    scopeList.innerHTML = '';

    // Default icon SVG for unknown scopes
    const defaultIconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

    scopes.forEach((scope) => {
        const scopeInfo = SCOPE_DESCRIPTIONS[scope] || {
            name: scope,
            description: `Access to ${scope}`,
            iconSvg: defaultIconSvg,
        };

        const li = document.createElement('li');
        li.className = 'scope-item';
        li.innerHTML = `
      <div class="scope-icon">${scopeInfo.iconSvg}</div>
      <div class="scope-info">
        <h4>${scopeInfo.name}</h4>
        <p>${scopeInfo.description}</p>
      </div>
    `;
        scopeList.appendChild(li);
    });
}

// Handle deny
function handleDeny(oauthParams: OAuthParams): void {
    const redirectUrl = new URL(oauthParams.redirectUri);
    redirectUrl.searchParams.set('error', 'access_denied');
    redirectUrl.searchParams.set('error_description', 'User denied access');
    if (oauthParams.state) {
        redirectUrl.searchParams.set('state', oauthParams.state);
    }
    window.location.href = redirectUrl.toString();
}

// Handle allow - submit to backend
async function handleAllow(oauthParams: OAuthParams): Promise<void> {
    btnAllow.disabled = true;
    btnDeny.disabled = true;
    btnAllow.innerHTML = '<div class="spinner"></div> Authorizing...';

    try {
        // Build authorize URL with all params
        const authorizeUrl = new URL(endpoints.authorize, window.location.origin);
        authorizeUrl.searchParams.set('client_id', oauthParams.clientId);
        authorizeUrl.searchParams.set('redirect_uri', oauthParams.redirectUri);
        authorizeUrl.searchParams.set('scope', oauthParams.scope);
        authorizeUrl.searchParams.set('response_type', oauthParams.responseType);
        if (oauthParams.state) {
            authorizeUrl.searchParams.set('state', oauthParams.state);
        }
        if (oauthParams.codeChallenge) {
            authorizeUrl.searchParams.set('code_challenge', oauthParams.codeChallenge);
        }
        if (oauthParams.codeChallengeMethod) {
            authorizeUrl.searchParams.set('code_challenge_method', oauthParams.codeChallengeMethod);
        }
        // Add consent approval
        authorizeUrl.searchParams.set('consent', 'approved');

        // Redirect to backend authorize endpoint
        window.location.href = authorizeUrl.toString();
    } catch {
        showError('Failed to authorize. Please try again.');
        btnAllow.disabled = false;
        btnDeny.disabled = false;
        btnAllow.innerHTML = 'Allow Access';
    }
}

// Initialize
async function init(): Promise<void> {
    // Check OAuth params
    const oauthParams = getOAuthParams();
    if (!oauthParams) {
        showError('Invalid authorization request. Missing required parameters.');
        return;
    }

    // Check if user is authenticated
    const token = getStoredToken();
    const storedUser = getStoredUser();

    if (!token || !storedUser) {
        // Redirect to login with return URL
        const returnUrl = window.location.href;
        window.location.href = `/login.html?return_url=${encodeURIComponent(returnUrl)}`;
        return;
    }

    // Verify token and get fresh user data
    try {
        const result = await apiRequest<{ user: User }>(endpoints.me);

        if (!result.success) {
            // Token expired, redirect to login
            const returnUrl = window.location.href;
            window.location.href = `/login.html?return_url=${encodeURIComponent(returnUrl)}`;
            return;
        }

        const user = result.data?.user || storedUser;
        populateUserInfo(user);

        // Fetch client info
        const clientResult = await apiRequest<OAuthClient>(
            `${endpoints.clients}/${oauthParams.clientId}`
        );

        if (!clientResult.success || !clientResult.data) {
            showError('Unknown application. The application requesting access is not registered.');
            return;
        }

        const client = clientResult.data;

        // Validate redirect URI
        const isValidRedirect = client.redirectUris.some(
            (uri) => oauthParams.redirectUri.startsWith(uri)
        );

        if (!isValidRedirect) {
            showError('Invalid redirect URI. This application is not authorized to use this redirect URI.');
            return;
        }

        // Populate UI
        populateClientInfo(client, oauthParams.redirectUri);
        populateScopes(oauthParams.scope.split(' '));

        // Attach event handlers
        btnDeny.addEventListener('click', () => handleDeny(oauthParams));
        btnAllow.addEventListener('click', () => handleAllow(oauthParams));

        showAuthContent();
    } catch {
        showError('Failed to load authorization details. Please try again.');
    }
}

// Run on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
