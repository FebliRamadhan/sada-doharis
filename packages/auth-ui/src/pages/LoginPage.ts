/**
 * Login Page Component
 * Only Email + SSO tabs (Internal tab removed)
 */
import {
    endpoints,
    apiRequest,
    setStoredToken,
    setStoredUser,
    type AuthResponse,
} from '../api';
import { router, getAppContainer, getQueryParams } from '../router';

export async function LoginPage(): Promise<void> {
    const app = getAppContainer();

    app.innerHTML = `
        <div class="auth-card">
            <!-- Brand Header -->
            <div class="brand">
                <div class="brand-logo">S</div>
                <h1>Sign in</h1>
                <p>Welcome back. Please sign in to continue.</p>
            </div>

            <!-- Error Alert -->
            <div id="error-alert" class="alert alert-error" style="display: none;">
                <svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span id="error-message"></span>
            </div>

            <!-- Login Tabs (Email + SSO only) -->
            <div class="tabs">
                <button class="tab-btn active" data-tab="email" type="button">Email</button>
                <button class="tab-btn" data-tab="sso" type="button">SSO</button>
            </div>

            <!-- Email/Password Tab -->
            <div id="tab-email" class="tab-content active">
                <form id="login-form">
                    <div class="form-group">
                        <label class="form-label" for="email">Email address</label>
                        <input type="email" id="email" name="email" class="form-input" 
                               placeholder="you@example.com" required autocomplete="email">
                    </div>

                    <div class="form-group">
                        <label class="form-label" for="password">Password</label>
                        <input type="password" id="password" name="password" class="form-input" 
                               placeholder="Enter your password" required autocomplete="current-password">
                    </div>

                    <button type="submit" class="btn btn-primary" id="submit-btn">
                        Sign in
                    </button>
                </form>
            </div>

            <!-- SSO Providers Tab -->
            <div id="tab-sso" class="tab-content">
                <div class="providers">
                    <a href="/api/auth/splp/authorize" class="btn-provider">
                        <span class="icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" 
                                 stroke-linecap="round" stroke-linejoin="round">
                                <path d="M3 21h18" />
                                <path d="M3 10h18" />
                                <polyline points="12 3 20 10 12 21 4 10" />
                            </svg>
                        </span>
                        Continue with SPLP (Government)
                    </a>

                    <a href="/api/auth/google" class="btn-provider">
                        <span class="icon">
                            <svg viewBox="0 0 24 24">
                                <path fill="#4285F4"
                                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                <path fill="#34A853"
                                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                <path fill="#FBBC05"
                                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                <path fill="#EA4335"
                                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                        </span>
                        Continue with Google
                    </a>

                    <a href="/api/auth/facebook" class="btn-provider">
                        <span class="icon">
                            <svg viewBox="0 0 24 24" fill="#1877F2">
                                <path
                                    d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                            </svg>
                        </span>
                        Continue with Facebook
                    </a>
                </div>
            </div>

            <!-- Security Badge -->
            <div class="security-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                    stroke-linejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>Secured with SSL encryption</span>
            </div>
        </div>
    `;

    initTabs();
    initLoginForm();
    checkUrlError();
}

function initTabs(): void {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const tabId = (btn as HTMLElement).dataset.tab;
            if (!tabId) return;

            tabButtons.forEach((b) => b.classList.remove('active'));
            tabContents.forEach((c) => c.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(`tab-${tabId}`)?.classList.add('active');
        });
    });
}

function initLoginForm(): void {
    const loginForm = document.getElementById('login-form') as HTMLFormElement;
    if (loginForm) {
        loginForm.addEventListener('submit', handleEmailLogin);
    }
}

function checkUrlError(): void {
    const params = getQueryParams();
    const error = params.get('error');
    if (error) {
        showError(decodeURIComponent(error));
    }
}

function showError(message: string): void {
    const errorAlert = document.getElementById('error-alert');
    const errorMessage = document.getElementById('error-message');
    if (errorAlert && errorMessage) {
        errorMessage.textContent = message;
        errorAlert.style.display = 'flex';
    }
}

function hideError(): void {
    const errorAlert = document.getElementById('error-alert');
    if (errorAlert) {
        errorAlert.style.display = 'none';
    }
}

function handleLoginSuccess(data: AuthResponse['data']): void {
    if (!data) return;

    setStoredToken(data.accessToken);
    setStoredUser(data.user);

    // Check if there's a return URL for OAuth flow
    const params = getQueryParams();
    const returnUrl = params.get('return_url');

    if (returnUrl) {
        window.location.href = returnUrl;
    } else {
        router.navigate('/');
    }
}

async function handleEmailLogin(e: Event): Promise<void> {
    e.preventDefault();
    hideError();

    const email = (document.getElementById('email') as HTMLInputElement).value;
    const password = (document.getElementById('password') as HTMLInputElement).value;
    const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="spinner"></div> Signing in...';

    try {
        const result = await apiRequest<AuthResponse['data']>(endpoints.login, {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });

        if (result.success && result.data) {
            handleLoginSuccess(result.data);
        } else {
            showError(result.error || 'Invalid email or password');
        }
    } catch {
        showError('Network error. Please try again.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Sign In</span>';
    }
}
