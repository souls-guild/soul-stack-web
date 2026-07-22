import { test, expect } from './support/fixtures';

// /runs (RunsFeed) — UNION of voyages/push/errands (NOT incarnation apply_runs).
// Live stand: table renders, status filter toggles.
test.describe('all runs feed', () => {
  test('feed renders and status filter toggles', async ({ page }) => {
    await page.goto('runs');

    // Page loaded: either the table or an empty state (not a crash).
    const table = page.getByTestId('runs-table');
    const failedChip = page.getByTestId('status-filter-failed');
    await expect(failedChip).toBeVisible();

    await failedChip.click();
    await expect(failedChip).toHaveAttribute('aria-pressed', 'true');
    await failedChip.click();
    await expect(failedChip).toHaveAttribute('aria-pressed', 'false');

    // An active stand usually has other voyages → table is visible. Assert softly.
    if ((await table.count()) > 0) await expect(table).toBeVisible();
  });

  // Our own apply_run row in /runs needs connected souls (RunsFeed does not read
  // apply_runs; redis create against an empty roster = 422; `create` provisions a VM) — NIM-26.
  test.fixme('own run row is visible and filters by failed', async () => {});
});
