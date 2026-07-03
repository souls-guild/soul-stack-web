import { test, expect } from './support/fixtures';
import { seedBareReady } from './support/seed';

// destroy-trigger показан при status=ready/drift. Засев — bare-ready hello-world.
// Если репозиторий сервиса hello-world пуст на стенде (чужая сессия), и seed, и
// сам destroy-сценарий недоступны → спека скипается с причиной.
test.describe('destroy', () => {
  test('диалог destroy сносит ready-инкарнацию', async ({ page, api, track }) => {
    const name = await seedBareReady(api, track);
    test.skip(
      name === null,
      'нет bare-ready инкарнации: сервис hello-world недоступен на стенде (пустой репозиторий)',
    );

    await page.goto(`incarnations/${name}`);
    await expect(page.getByTestId('destroy-trigger')).toBeVisible();
    await page.getByTestId('destroy-trigger').click();

    await page.getByTestId('destroy-confirm-input').fill(name!);
    await page.getByTestId('destroy-allow-checkbox').check();
    await page.getByTestId('destroy-submit').click();

    await expect(page.getByTestId('destroy-error')).toHaveCount(0);
    await expect(page).toHaveURL(/\/incarnations$/);

    // API-подтверждение: инкарнация ушла (gone/404), толерантно к задержке destroy.
    await expect
      .poll(async () => (await api.getIncarnation(name!)).status, { timeout: 15_000 })
      .toBe(404);
  });
});
