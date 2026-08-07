/// <reference types="vitest" />
import os from 'node:os';
import path from 'node:path';
import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest sizes its fork pool to availableParallelism — max(cores - 1, 1) in run mode —
// and every fork builds its own jsdom environment (~1.4s) and holds it for the whole
// file. What that oversubscribes on a many-core workstation is memory and GC, not CPU,
// so past a point more forks make each INDIVIDUAL test slower. Measured cold on this
// suite (NIM-467/NIM-468), varying the visible core count with taskset:
//
//   cores   forks   slowest test (MembersPanelVitals, 1000 rows)   wall clock
//      24      23                                         3078ms         41s
//       4       3                                         1462ms        106s
//
// i.e. 23 forks ran that test 2.1x slower than 3 did. That is what walked integration
// tests up to vitest's 5000ms default and made the failing file look random from run
// to run — the pool, not the individual tests, was the variable.
//
// The subtraction is load-bearing, not cosmetic. CI runners have 4 vCPU, where vitest
// picks 3 forks on its own; capping at min(cores, 8) would hand CI a FOURTH fork and
// oversubscribe the one machine this change is supposed to leave untouched. Taking the
// floor from vitest's own default makes this a no-op by construction below the cap —
// it only bites on workstations.
const cores = os.availableParallelism?.() ?? os.cpus().length;
const testMaxWorkers = Math.max(1, Math.min(cores - 1, 8));

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
    // See testMaxWorkers above. Deliberately NOT paired with a raised testTimeout:
    // 5000ms stays the default so a genuinely stuck test still fails as one, and the
    // handful of tests that honestly need longer say so at the `it` that needs it.
    maxWorkers: testMaxWorkers,
  },
});
