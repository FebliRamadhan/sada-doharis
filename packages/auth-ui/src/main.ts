/**
 * Auth UI - Main Entry Point
 * SPA with client-side routing
 */
import './style.css';
import { router } from './router';
import { loadRuntimeConfig, isRegistrationEnabled } from './runtime-config';
import {
  HomePage,
  LoginPage,
  RegisterPage,
  ForgotPasswordPage,
  PortalPage,
  AuthorizePage,
  CallbackPage,
  AdminPage,
  MFAVerifyPage,
  MFASetupPage,
} from './pages';

// Remove admin overlay on every navigation away from /admin
const origResolve = router['resolve'].bind(router);
router['resolve'] = async function () {
  document.getElementById('admin-overlay')?.remove();
  document.querySelector('.auth-container')?.classList.remove('admin-mode');
  return origResolve();
};

// Setup routes
router
  .on('/', HomePage)
  .on('/login', LoginPage)
  // Guarded, not removed: hiding the link is not enough — a bookmarked or
  // hand-typed /register must not render a form the server answers with 404.
  .on('/register', () => {
    if (!isRegistrationEnabled()) {
      router.navigate('/login', true);
      return;
    }
    RegisterPage();
  })
  .on('/forgot-password', ForgotPasswordPage)
  .on('/portal', PortalPage)
  .on('/authorize', AuthorizePage)
  .on('/callback', CallbackPage)
  .on('/mfa/verify', MFAVerifyPage)
  .on('/mfa/setup', MFASetupPage)
  .on('/admin', AdminPage)
  .notFound(() => {
    // Redirect unknown routes to home
    router.navigate('/', true);
  });

// Load runtime config before the first route renders, so pages never flash a
// signup path that is switched off. A failed fetch leaves it disabled.
async function start(): Promise<void> {
  await loadRuntimeConfig();
  router.start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void start());
} else {
  void start();
}
