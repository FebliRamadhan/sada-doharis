import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        port: 3002,
        proxy: {
            '/api': {
                target: 'http://localhost:3001',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, ''),
            },
        },
    },
    build: {
        outDir: 'dist',
        // Single entry point for SPA
    },
    // Enable SPA fallback for client-side routing
    appType: 'spa',
});
