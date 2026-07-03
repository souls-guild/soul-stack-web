import { test, expect, uniqueName } from './support/fixtures';

// UI↔backend каталог: сервис redis наполняет create-scenario-select. Жёстко
// create_from_souls (НЕ `create` = provision VM); пустой roster → 422 → error.
test.describe('incarnation create form', () => {
  test('каталог сервис→сценарии наполняется из backend; submit сюрфейсит ошибку', async ({
    page,
  }) => {
    await page.goto('incarnations/new');

    const serviceSelect = page.getByTestId('incarnation-service-select');
    await expect(serviceSelect).toBeVisible();
    await expect(serviceSelect.locator('option[value="redis"]')).toHaveCount(1);

    await serviceSelect.selectOption('redis');

    const scenarioSelect = page.getByTestId('create-scenario-select');
    await expect(page.getByTestId('create-scenario-select-wrapper')).toBeVisible();
    await expect(scenarioSelect.locator('option')).not.toHaveCount(0);
    await expect(scenarioSelect.locator('option', { hasText: 'create_from_souls' })).toHaveCount(1);

    await scenarioSelect.selectOption('create_from_souls');
    await expect(scenarioSelect).toHaveValue('create_from_souls');

    await page.getByTestId('incarnation-name-input').fill(uniqueName('cre'));

    // version-поле (если сценарий его требует): первая доступная опция, без хардкода.
    const versionSelect = page.getByTestId('field-enum-version');
    await versionSelect.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
    if (await versionSelect.count()) {
      const firstVersion = await versionSelect.locator('option').nth(1).getAttribute('value');
      if (firstVersion) await versionSelect.selectOption(firstVersion);
    }

    // Guard: перед submit подтверждаем безопасный сценарий (НЕ провижен VM).
    await expect(scenarioSelect).toHaveValue('create_from_souls');
    await page.getByTestId('incarnation-submit').click();

    await expect(page.getByTestId('incarnation-create-error')).toBeVisible();
  });
});
