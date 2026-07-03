import { test, expect, uniqueName } from './support/fixtures';
import { seedPendingSouls } from './support/seed';

// Засев: 2 pending-души (transport agent/ssh) в уникальном coven. Ассертим
// только свои строки; чужие soul-e2e-* в реестре терпим. Проекция connected —
// NIM-26 (для этого нужен живой docker-флот душ).
test.describe('souls list', () => {
  test('свои pending-души видны в таблице и фильтруются по coven', async ({ page, api }) => {
    const coven = uniqueName('coven');
    const [sidA, sidB] = await seedPendingSouls(api, coven, 2);

    await page.goto('souls');
    await expect(page.getByTestId('souls-table')).toBeVisible();
    await expect(page.getByTestId(`souls-row-${sidA}`)).toBeVisible();
    await expect(page.getByTestId(`souls-row-${sidB}`)).toBeVisible();

    // Фильтр по уникальному coven (server-side) → остаются только свои 2 строки.
    await page.getByTestId('souls-coven-filter').fill(coven);
    await expect(page.getByTestId(`souls-row-${sidA}`)).toBeVisible();
    await expect(page.getByTestId(`souls-row-${sidB}`)).toBeVisible();
    await expect(page.locator('[data-testid^="souls-row-"]')).toHaveCount(2);
  });
});
