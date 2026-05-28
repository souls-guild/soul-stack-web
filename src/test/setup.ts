import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
// Инициализация i18n для тестов (default-locale ru). Без этого t() возвращает
// сырые ключи. Тесты матчат ru-строки как default-вывод.
import i18n, { DEFAULT_LANG } from '../i18n';

afterEach(() => {
  cleanup();
  // Возвращаем язык к default между тестами (тест мог переключить на en).
  if (i18n.language !== DEFAULT_LANG) {
    void i18n.changeLanguage(DEFAULT_LANG);
  }
});
