import { test, expect } from './support/fixtures';
import { seedBareReady } from './support/seed';

// destroy-trigger is shown when status=ready/drift. Seed — bare-ready hello-world.
// If the hello-world service repo is empty on the stand (another session), both the seed
// and the destroy scenario are unavailable → spec skips with a reason.
test.describe('destroy', () => {
  test('destroy dialog tears down a ready incarnation', async ({ page, api, track }) => {
    const name = await seedBareReady(api, track);
    test.skip(
      name === null,
      'no bare-ready incarnation: hello-world service unavailable on the stand (empty repo)',
    );

    await page.goto(`incarnations/${name}`);
    await expect(page.getByTestId('destroy-trigger')).toBeVisible();
    await page.getByTestId('destroy-trigger').click();

    await page.getByTestId('destroy-confirm-input').fill(name!);
    await page.getByTestId('destroy-allow-checkbox').check();
    await page.getByTestId('destroy-submit').click();

    await expect(page.getByTestId('destroy-error')).toHaveCount(0);
    await expect(page).toHaveURL(/\/incarnations$/);

    // API confirmation: incarnation is gone (gone/404), tolerant of destroy latency.
    await expect
      .poll(async () => (await api.getIncarnation(name!)).status, { timeout: 15_000 })
      .toBe(404);
  });
});
