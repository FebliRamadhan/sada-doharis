/**
 * Callback Page Component
 * Handles OAuth callback responses
 */
import { setStoredToken, setStoredUser, type User } from '../api';
import { router, getAppContainer, getQueryParams } from '../router';

export async function CallbackPage(): Promise<void> {
  const app = getAppContainer();

  app.innerHTML = `
    <div class="auth-card">
      <div class="form-header">
        <h1 id="title">Processing</h1>
        <p id="subtitle">Please wait…</p>
      </div>

      <div id="loading-state" class="auth-state" role="status">
        <div class="spinner spinner-dark spinner-lg"></div>
        <p id="status-message">Processing authentication…</p>
      </div>

      <div id="success-state" class="auth-state is-success" style="display: none;" role="status">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
        <p>Authentication successful!</p>
      </div>

      <div id="error-state" class="auth-state is-error" style="display: none;" role="alert">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
        <p id="error-message">Something went wrong</p>
        <p id="error-details" class="auth-state-detail"></p>
        <a href="/login" class="btn btn-secondary is-inline">Back to Login</a>
      </div>

      <p class="security-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
        <span>Secured connection</span>
      </p>
    </div>
  `;

  handleCallback();
}

function showLoading(message: string): void {
  const loadingState = document.getElementById('loading-state');
  const successState = document.getElementById('success-state');
  const errorState = document.getElementById('error-state');
  const statusMessage = document.getElementById('status-message');

  if (loadingState) loadingState.style.display = 'flex';
  if (successState) successState.style.display = 'none';
  if (errorState) errorState.style.display = 'none';
  if (statusMessage) statusMessage.textContent = message;
}

function showSuccess(): void {
  const loadingState = document.getElementById('loading-state');
  const successState = document.getElementById('success-state');
  const errorState = document.getElementById('error-state');
  const title = document.getElementById('title');
  const subtitle = document.getElementById('subtitle');

  if (loadingState) loadingState.style.display = 'none';
  if (successState) successState.style.display = 'flex';
  if (errorState) errorState.style.display = 'none';
  if (title) title.textContent = 'Success';
  if (subtitle) subtitle.textContent = 'Authentication completed successfully';
}

function showError(message: string, details?: string): void {
  const loadingState = document.getElementById('loading-state');
  const successState = document.getElementById('success-state');
  const errorState = document.getElementById('error-state');
  const errorMessage = document.getElementById('error-message');
  const errorDetails = document.getElementById('error-details');
  const title = document.getElementById('title');
  const subtitle = document.getElementById('subtitle');

  if (loadingState) loadingState.style.display = 'none';
  if (successState) successState.style.display = 'none';
  if (errorState) errorState.style.display = 'flex';
  if (title) title.textContent = 'Error';
  if (subtitle) subtitle.textContent = 'Authentication failed';
  if (errorMessage) errorMessage.textContent = message;
  if (errorDetails && details) errorDetails.textContent = details;
}

async function handleCallback(): Promise<void> {
  const params = getQueryParams();

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
    showLoading('Processing authorization code…');
    showSuccess();

    // If there's a parent window (popup flow), communicate with it
    if (window.opener) {
      window.opener.postMessage(
        {
          type: 'oauth_callback',
          code,
          state: params.get('state'),
        },
        '*'
      );
      setTimeout(() => window.close(), 2000);
    }
    return;
  }

  // Check for access token (implicit flow or direct token)
  const accessToken = params.get('access_token');
  if (accessToken) {
    showLoading('Storing access token…');
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
      router.navigate(returnUrl);
    }, 1500);
    return;
  }

  // Check for SPLP callback
  const splpToken = params.get('splp_token');
  if (splpToken) {
    showLoading('Verifying SPLP authentication…');
    showSuccess();
    return;
  }

  // No recognized callback parameters
  showError('Invalid callback', 'No valid authentication response was found.');
}
