import './style.css';
import {
    setStoredToken,
    setStoredUser,
    getUrlParams,
    type User,
} from './api';

// DOM Elements
const loadingState = document.getElementById('loading-state') as HTMLElement;
const successState = document.getElementById('success-state') as HTMLElement;
const errorState = document.getElementById('error-state') as HTMLElement;
const errorMessage = document.getElementById('error-message') as HTMLElement;
const errorDetails = document.getElementById('error-details') as HTMLElement;
const statusMessage = document.getElementById('status-message') as HTMLElement;
const title = document.getElementById('title') as HTMLElement;
const subtitle = document.getElementById('subtitle') as HTMLElement;

// Show states
function showLoading(message: string): void {
    loadingState.style.display = 'flex';
    successState.style.display = 'none';
    errorState.style.display = 'none';
    statusMessage.textContent = message;
}

function showSuccess(): void {
    loadingState.style.display = 'none';
    successState.style.display = 'flex';
    errorState.style.display = 'none';
    title.textContent = 'Success';
    subtitle.textContent = 'Authentication completed successfully';
}

function showError(message: string, details?: string): void {
    loadingState.style.display = 'none';
    successState.style.display = 'none';
    errorState.style.display = 'flex';
    title.textContent = 'Error';
    subtitle.textContent = 'Authentication failed';
    errorMessage.textContent = message;
    if (details) {
        errorDetails.textContent = details;
    }
}

// Handle different callback types
async function handleCallback(): Promise<void> {
    const params = getUrlParams();

    // Check for error in callback
    const error = params.get('error');
    if (error) {
        const errorDesc = params.get('error_description') || 'An error occurred during authentication';
        showError(error, errorDesc);
        return;
    }

    // Check for authorization code
    const code = params.get('code');
    if (code) {
        showLoading('Processing authorization code...');
        // The code will be handled by the client application
        // This page just shows status to the user
        showSuccess();

        // If there's a parent window (popup flow), communicate with it
        if (window.opener) {
            window.opener.postMessage({
                type: 'oauth_callback',
                code,
                state: params.get('state'),
            }, '*');
            setTimeout(() => window.close(), 2000);
        }
        return;
    }

    // Check for access token (implicit flow)
    const accessToken = params.get('access_token');
    if (accessToken) {
        showLoading('Storing access token...');
        setStoredToken(accessToken);

        // Try to get user info if available
        const userJson = params.get('user');
        if (userJson) {
            try {
                const user = JSON.parse(decodeURIComponent(userJson)) as User;
                setStoredUser(user);
            } catch {
                // Ignore JSON parse errors
            }
        }

        showSuccess();

        // Redirect to home after short delay
        const returnUrl = params.get('return_url') || '/';
        setTimeout(() => {
            window.location.href = returnUrl;
        }, 1500);
        return;
    }

    // Check for SPLP callback
    const splpToken = params.get('splp_token');
    if (splpToken) {
        showLoading('Verifying SPLP authentication...');
        // The auth-service will handle the SPLP token exchange
        // For now, just show success if we got here
        showSuccess();
        return;
    }

    // No recognized callback parameters
    showError('Invalid callback', 'No valid authentication response was found.');
}

// Initialize
function init(): void {
    showLoading('Processing authentication...');
    handleCallback();
}

// Run on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
