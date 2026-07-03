import { test, expect, uniqueName } from './support/fixtures';

// Run-view = деталь apply_run инкарнации. Проверяем, что роут грузится в
// защищённом app-shell (routing + auth + рендер); реальный прогон — fixme (NIM-26).
test.describe('run view', () => {
  test('роут run-view грузится в app-shell', async ({ page }) => {
    const name = uniqueName('rv');
    await page.goto(`incarnations/${name}/runs/01KWJJF76YVR55AA2JAN2VFJTG`);
    // Shell защищённой зоны отрисован (не редиректнуло на /login, не пусто).
    await expect(page.getByTestId('topbar-settings-link')).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
  });

  // Реальный терминальный прогон недостижим без connected-душ (обоснование —
  // all-runs.spec.ts: redis create = 422/provision VM) — NIM-26.
  test.fixme('run-status + hosts/failed-section на реальном прогоне', async () => {});
});
