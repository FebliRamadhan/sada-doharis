/**
 * Simple client-side router for SPA
 */

export type RouteHandler = () => Promise<void> | void;

interface Route {
    path: string;
    handler: RouteHandler;
}

class Router {
    private routes: Route[] = [];
    private notFoundHandler: RouteHandler | null = null;

    /**
     * Add a route
     */
    on(path: string, handler: RouteHandler): this {
        this.routes.push({ path, handler });
        return this;
    }

    /**
     * Set 404 handler
     */
    notFound(handler: RouteHandler): this {
        this.notFoundHandler = handler;
        return this;
    }

    /**
     * Navigate to a path
     */
    navigate(path: string, replace = false): void {
        if (replace) {
            history.replaceState(null, '', path);
        } else {
            history.pushState(null, '', path);
        }
        this.resolve();
    }

    /**
     * Resolve current path and execute handler
     */
    async resolve(): Promise<void> {
        const path = window.location.pathname;

        for (const route of this.routes) {
            if (this.matchPath(route.path, path)) {
                await route.handler();
                return;
            }
        }

        // 404
        if (this.notFoundHandler) {
            await this.notFoundHandler();
        }
    }

    /**
     * Match path with route (supports basic params)
     */
    private matchPath(routePath: string, currentPath: string): boolean {
        // Exact match
        if (routePath === currentPath) return true;

        // Check trailing slash
        const normalizedRoute = routePath.replace(/\/$/, '');
        const normalizedPath = currentPath.replace(/\/$/, '');

        return normalizedRoute === normalizedPath;
    }

    /**
     * Initialize router
     */
    start(): void {
        // Handle popstate (back/forward)
        window.addEventListener('popstate', () => this.resolve());

        // Handle clicks on internal links
        document.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const anchor = target.closest('a');

            if (!anchor) return;

            const href = anchor.getAttribute('href');
            if (!href) return;

            // Only handle internal links
            if (href.startsWith('/') && !href.startsWith('//')) {
                e.preventDefault();
                this.navigate(href);
            }
        });

        // Resolve initial route
        this.resolve();
    }
}

// Singleton instance
export const router = new Router();

// Helper to get URL query params
export function getQueryParams(): URLSearchParams {
    return new URLSearchParams(window.location.search);
}

// Helper to get app container
export function getAppContainer(): HTMLElement {
    const app = document.getElementById('app');
    if (!app) throw new Error('App container not found');
    return app;
}
