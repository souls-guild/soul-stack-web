import { test, expect, uniqueName } from './support/fixtures';
import { seedIncarnationWithCovenTraits } from './support/seed';

// Client-side мультиселект coven+traits (ADR-042: опции считаются из подгруженных
// /v1/incarnations, не из backend-каталога). Полный путь — свои 2 инкарнации
// A/B с covens/traits; если сервис bare недоступен на стенде, деградируем до
// structural-проверки фильтра на живых данных, свои чипы → NIM-26.
test.describe('coven/traits filter', () => {
  test('фильтр coven/traits рендерится и переключается', async ({ page, api, track }) => {
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

    // Деградация: bare-инкарнации нельзя засеять (сервис недоступен) — проверяем
    // сам механизм фильтра на любых доступных (чужих) чипах. Свои coven-a/b → NIM-26.
    test.info().annotations.push({
      type: 'partial',
      description: 'bare-инкарнации не засеиваются на этом стенде; свои coven/traits-чипы отложены до NIM-26',
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
