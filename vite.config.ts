/// <reference types="vitest" />
import os from 'node:os';
import path from 'node:path';
import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest sizes its fork pool to availableParallelism — max(cores - 1, 1) in run mode —
// and every fork builds its own jsdom environment and holds it for the whole file. Past
// a point more forks make each INDIVIDUAL test slower. Measured cold on this suite
// (NIM-467/NIM-468), holding the machine at 24 visible cores and varying ONLY the pool:
//
//   forks   slowest test (MembersPanelVitals, 1000 rows)
//      23                                         3078ms
//       8                                    1904ms (1.62x)
//
// against a mean of 1798ms over three further 8-fork cold runs, i.e. 1.71x. That is what
// walked integration tests up to vitest's 5000ms default and made the failing file look
// random from run to run — the pool, not the individual tests, was the variable.
//
// The mechanism is CPU contention, and the number that matters is PHYSICAL cores rather
// than the one availableParallelism reports: this box is a 12-core Ryzen presenting 24
// threads via SMT, so 23 forks plus the main process oversubscribe it roughly 2:1 and
// SMT siblings then split each core's real throughput. It is not memory — an earlier
// revision of this comment claimed memory and GC, which was never measured and does not
// survive the arithmetic (~50 GB free, zero swap, and jsdom environments that cost
// hundreds of megabytes in total). The inflation shows up evenly across transform, setup,
// import and environment time, which is the signature of general contention, not of GC.
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
