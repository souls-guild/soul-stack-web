import { test, expect, uniqueName } from './support/fixtures';
import { seedPendingSouls } from './support/seed';

// Seed: 2 pending souls (transport agent/ssh) in a unique coven. Assert only
// our own rows; foreign soul-e2e-* in the registry are tolerated. Connected projection —
// NIM-26 (needs live souls running in docker).
test.describe('souls list', () => {
  test('own pending souls are visible in the table and filter by coven', async ({ page, api }) => {
    const coven = uniqueName('coven');
    const [sidA, sidB] = await seedPendingSouls(api, coven, 2);

    await page.goto('souls');
    await expect(page.getByTestId('souls-table')).toBeVisible();
    await expect(page.getByTestId(`souls-row-${sidA}`)).toBeVisible();
    await expect(page.getByTestId(`souls-row-${sidB}`)).toBeVisible();

    // Filter by the unique coven (server-side) → only our own 2 rows remain.
    await page.getByTestId('souls-coven-filter').fill(coven);
    await expect(page.getByTestId(`souls-row-${sidA}`)).toBeVisible();
    await expect(page.getByTestId(`souls-row-${sidB}`)).toBeVisible();
    await expect(page.locator('[data-testid^="souls-row-"]')).toHaveCount(2);
  });
});
