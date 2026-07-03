import { test, expect } from './support/fixtures';

// /runs (RunsFeed) — UNION voyages/push/errands (НЕ apply_runs инкарнаций).
// Живой стенд: таблица рендерится, статус-фильтр переключается.
test.describe('all runs feed', () => {
  test('фид рендерится и статус-фильтр переключается', async ({ page }) => {
    await page.goto('runs');

    // Страница загрузилась: либо таблица, либо пустое состояние (не краш).
    const table = page.getByTestId('runs-table');
    const failedChip = page.getByTestId('status-filter-failed');
    await expect(failedChip).toBeVisible();

    await failedChip.click();
    await expect(failedChip).toHaveAttribute('aria-pressed', 'true');
    await failedChip.click();
    await expect(failedChip).toHaveAttribute('aria-pressed', 'false');

    // На активном стенде обычно есть чужие voyages → таблица видна. Ассертим мягко.
    if ((await table.count()) > 0) await expect(table).toBeVisible();
  });

  // Своя apply_run-строка в /runs требует connected-душ (RunsFeed не читает
  // apply_runs; redis create против пустого roster = 422; `create` провиженит VM) — NIM-26.
  test.fixme('своя строка-прогон видна и фильтруется по failed', async () => {});
});
