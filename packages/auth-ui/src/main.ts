/**
 * Auth UI - Main Entry Point
 * SPA with client-side routing
 */
import './style.css';
import { router } from './router';
import { HomePage, LoginPage, AuthorizePage, CallbackPage } from './pages';

// Setup routes
router
    .on('/', HomePage)
    .on('/login', LoginPage)
    .on('/authorize', AuthorizePage)
    .on('/callback', CallbackPage)
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
