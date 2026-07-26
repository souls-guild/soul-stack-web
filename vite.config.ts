/// <reference types="vitest" />
import path from 'node:path';
import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Dev mode: proxy /v1 and health endpoints to the Keeper Operator API
// (default http://localhost:8080, listen.openapi.addr from keeper.yml).
// Override via the VITE_KEEPER_API environment variable.
const keeperTarget = process.env.VITE_KEEPER_API ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  // base: '/ui/' is required for go:embed serving of the SPA from /ui (ADR-055).
  // All asset links in dist/index.html become /ui/assets/..., not /assets/...
  // In dev mode the vite dev server serves the app at localhost:5173/ui/
  base: '/ui/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // ws:true is required for the multi-console upgrade (/v1/console); without
      // it the dev server answers the Upgrade request with plain HTTP.
      '/v1': { target: keeperTarget, changeOrigin: true, ws: true },
      '/healthz': { target: keeperTarget, changeOrigin: true },
      '/readyz': { target: keeperTarget, changeOrigin: true },
      '/openapi.yaml': { target: keeperTarget, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // Playwright specs (e2e/*.spec.ts) must not end up in vitest discovery.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
