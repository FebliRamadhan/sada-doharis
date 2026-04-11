/**
 * Auth UI - Main Entry Point
 * SPA with client-side routing
 */
import './style.css';
import { router } from './router';
import { HomePage, LoginPage, AuthorizePage, CallbackPage, AdminPage } from './pages';

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
    .on('/authorize', AuthorizePage)
    .on('/callback', CallbackPage)
    .on('/admin', AdminPage)
    .notFound(() => {
        // Redirect unknown routes to home
        router.navigate('/', true);
    });

// Start router when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => router.start());
} else {
    router.start();
}
