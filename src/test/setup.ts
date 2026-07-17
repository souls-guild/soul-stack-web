import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
// Initializes i18n for tests (default locale en). Without this t() returns
// raw keys. Tests match en strings as the default output.
import i18n, { DEFAULT_LANG } from '../i18n';

afterEach(() => {
  cleanup();
  // Reset the language to default between tests (a test may have switched to en).
  if (i18n.language !== DEFAULT_LANG) {
    void i18n.changeLanguage(DEFAULT_LANG);
  }
});

// Resets vi.stubGlobal stubs: registered last -> runs first
// (afterEach hooks run in LIFO order), so fetch stubs are torn down BEFORE cleanup.
afterEach(() => {
  vi.unstubAllGlobals();
});
