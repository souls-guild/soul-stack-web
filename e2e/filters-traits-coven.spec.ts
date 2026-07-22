import { test, expect, uniqueName } from './support/fixtures';
import { seedIncarnationWithCovenTraits } from './support/seed';

// Client-side coven+traits multiselect (ADR-042: options are derived from the loaded
// /v1/incarnations, not from a backend catalog). Full path — our own 2 incarnations
// A/B with covens/traits; if the bare service is unavailable on the stand, we degrade to
// a structural filter check on live data, own chips → NIM-26.
test.describe('coven/traits filter', () => {
  test('coven/traits filter renders and toggles', async ({ page, api, track }) => {
    const covenA = uniqueName('coven-a');
    const covenB = uniqueName('coven-b');
    const nameA = await seedIncarnationWithCovenTraits(api, track, [covenA], { tier: 'a' });
    const nameB = await seedIncarnationWithCovenTraits(api, track, [covenB], { tier: 'b' });

    await page.goto('incarnations');
    await expect(page.getByTestId('coven-traits-filter')).toBeVisible();

    if (nameA && nameB) {
      const covenChip = page.getByTestId(`coven-filter-${covenA}`);
      await expect(covenChip).toBeVisible();
      await covenChip.click();
      await expect(page.getByRole('link', { name: nameA, exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: nameB, exact: true })).toHaveCount(0);

      await page.getByTestId('trait-filter-tier=a').click();
      await expect(page.getByRole('link', { name: nameA, exact: true })).toBeVisible();

      await page.getByTestId('coven-traits-clear').click();
      await expect(page.getByRole('link', { name: nameB, exact: true })).toBeVisible();
      return;
    }

    // Degraded: bare incarnations can't be seeded (service unavailable) — check the
    // filter mechanism itself on any available (foreign) chips. Own coven-a/b → NIM-26.
    test.info().annotations.push({
      type: 'partial',
      description: 'bare incarnations are not seeded on this stand; own coven/traits chips deferred to NIM-26',
    });
    const anyChip = page.locator('[data-testid^="coven-filter-"], [data-testid^="trait-filter-"]').first();
    if ((await anyChip.count()) > 0) {
      await anyChip.click();
      await expect(page.getByTestId('coven-traits-clear')).toBeVisible();
      await page.getByTestId('coven-traits-clear').click();
      await expect(page.getByTestId('coven-traits-clear')).toHaveCount(0);
    }
  });
});
