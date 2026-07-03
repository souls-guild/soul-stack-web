import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './support/fixtures';

const HERE = dirname(fileURLToPath(import.meta.url));

function realToken(): string {
  const fromEnv = process.env.SMOKE_JWT?.trim();
  if (fromEnv) return fromEnv;
  return readFileSync(resolve(HERE, '.auth', 'token.txt'), 'utf8').trim();
}

// Без предзагруженного storageState — форма /login с нуля.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('login', () => {
  test('позитив: валидный токен → редирект на /incarnations', async ({ page }) => {
    await page.goto('login');
    await page.getByTestId('login-token-input').fill(realToken());
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/(incarnations|overview)/);
    await expect(page.getByTestId('login-error')).toHaveCount(0);
    // Не только смена URL — authed-вью реально отрисовался.
    await expect(page.getByTestId('incarnations-service-filter')).toBeVisible();
  });

  test('негатив (контроль): невалидный токен → login-error, остаёмся на /login', async ({ page }) => {
    await page.goto('login');
    await page.getByTestId('login-token-input').fill('not.a.jwt');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
