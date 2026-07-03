import { test, expect } from './support/fixtures';
import { seedErrorLocked } from './support/seed';

// rerun-last-trigger в UI показан ТОЛЬКО при status=error_locked. Флоу написан
// полностью; на стендах без connected-душ засев error_locked недостижим
// (create_from_souls в пустой roster = 422 render-assert) → спека скипается с
// причиной. Разблокируется в NIM-26.
test.describe('rerun last', () => {
  test('открыть модалку rerun-last и отправить причину', async ({ page, api, track }) => {
    const name = await seedErrorLocked(api, track);
    test.skip(
      name === null,
      'нет error_locked-инкарнации: redis create_from_souls против пустого roster = 422 (нужны connected-души, NIM-26)',
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
