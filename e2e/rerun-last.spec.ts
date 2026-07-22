import { test, expect } from './support/fixtures';
import { seedErrorLocked } from './support/seed';

// rerun-last-trigger is shown in the UI ONLY when status=error_locked. The flow is
// written in full; on stands without connected souls, seeding error_locked is
// unreachable (create_from_souls into an empty roster = 422 render-assert) → spec skips
// with a reason. Unblocked in NIM-26.
test.describe('rerun last', () => {
  test('open the rerun-last modal and submit a reason', async ({ page, api, track }) => {
    const name = await seedErrorLocked(api, track);
    test.skip(
      name === null,
      'no error_locked incarnation: redis create_from_souls against an empty roster = 422 (needs connected souls, NIM-26)',
    );

    await page.goto(`incarnations/${name}`);
    await expect(page.getByTestId('rerun-last-trigger')).toBeVisible();
    await page.getByTestId('rerun-last-trigger').click();
    await page.getByTestId('rerun-reason-input').fill('smoke rerun');
    await page.getByTestId('rerun-submit').click();
    await expect(page.getByTestId('rerun-error')).toHaveCount(0);
    await expect(page.getByTestId('rerun-reason-input')).toHaveCount(0);
  });
});
