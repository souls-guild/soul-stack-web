import { test, expect, uniqueName } from './support/fixtures';

// Run-view = incarnation apply_run detail. Verify the route loads inside the
// protected app-shell (routing + auth + render); a real run — fixme (NIM-26).
test.describe('run view', () => {
  test('run-view route loads in the app-shell', async ({ page }) => {
    const name = uniqueName('rv');
    await page.goto(`incarnations/${name}/runs/01KWJJF76YVR55AA2JAN2VFJTG`);
    // Protected-zone shell rendered (not redirected to /login, not empty).
    await expect(page.getByTestId('topbar-settings-link')).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
  });

  // A real terminal run is unreachable without connected souls (rationale —
  // all-runs.spec.ts: redis create = 422/provision VM) — NIM-26.
  test.fixme('run-status + hosts/failed-section on a real run', async () => {});
});
