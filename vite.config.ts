/// <reference types="vitest" />
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Dev-режим: проксируем /v1 и health-endpoints на Keeper Operator API
// (по умолчанию http://localhost:8080, listen.openapi.addr из keeper.yml).
// Переопределить через переменную окружения VITE_KEEPER_API.
const keeperTarget = process.env.VITE_KEEPER_API ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/v1': { target: keeperTarget, changeOrigin: true },
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
  },
});
