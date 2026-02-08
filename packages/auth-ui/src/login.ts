import './style.css';
import {
    endpoints,
    apiRequest,
    setStoredToken,
    setStoredUser,
    getUrlParams,
    type AuthResponse,
} from './api';

// DOM Elements
const loginForm = document.getElementById('login-form') as HTMLFormElement;
const ldapForm = document.getElementById('ldap-form') as HTMLFormElement;
const errorAlert = document.getElementById('error-alert') as HTMLElement;
const errorMessage = document.getElementById('error-message') as HTMLElement;
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// Initialize tabs
function initTabs(): void {
    tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const tabId = (btn as HTMLElement).dataset.tab;
            if (!tabId) return;

            // Update active states
            tabButtons.forEach((b) => b.classList.remove('active'));
            tabContents.forEach((c) => c.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(`tab-${tabId}`)?.classList.add('active');
        });
    });
}

// Show error message
function showError(message: string): void {
    errorMessage.textContent = message;
    errorAlert.style.display = 'flex';
}

// Hide error message
function hideError(): void {
    errorAlert.style.display = 'none';
}

// Handle successful login
function handleLoginSuccess(data: AuthResponse['data']): void {
    if (!data) return;

    setStoredToken(data.accessToken);
    setStoredUser(data.user);

    // Check if there's a return URL for OAuth flow
    const params = getUrlParams();
    const returnUrl = params.get('return_url');

    if (returnUrl) {
        // Redirect to authorize page with original OAuth params
        window.location.href = returnUrl;
    } else {
        // Redirect to home/dashboard
        window.location.href = '/';
    }
}

// Email/Password login
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

// LDAP login
async function handleLdapLogin(e: Event): Promise<void> {
    e.preventDefault();
    hideError();

    const username = (document.getElementById('ldap-username') as HTMLInputElement).value;
    const password = (document.getElementById('ldap-password') as HTMLInputElement).value;
    const form = document.getElementById('ldap-form') as HTMLFormElement;
    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="spinner"></div> Signing in...';

    try {
        const result = await apiRequest<AuthResponse['data']>(endpoints.ldapLogin, {
            method: 'POST',
            body: JSON.stringify({ username, password }),
        });

        if (result.success && result.data) {
            handleLoginSuccess(result.data);
        } else {
            showError(result.error || 'Invalid LDAP credentials');
        }
    } catch {
        showError('Network error. Please try again.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>🏛️</span><span>Sign In with LDAP</span>';
    }
}

// Initialize
function init(): void {
    initTabs();

    // Attach form handlers
    if (loginForm) {
        loginForm.addEventListener('submit', handleEmailLogin);
    }

    if (ldapForm) {
        ldapForm.addEventListener('submit', handleLdapLogin);
    }

    // Check for error in URL params
    const params = getUrlParams();
    const error = params.get('error');
    if (error) {
        showError(decodeURIComponent(error));
    }
}

// Run on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
