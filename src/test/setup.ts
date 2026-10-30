import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
// Initializes i18n for tests (default locale en). Without this t() returns
// raw keys. Tests match en strings as the default output.
import i18n, { DEFAULT_LANG } from '../i18n';
import { TIME_ZONE_STORAGE_KEY } from '../hooks/timeZoneConstants';

afterEach(() => {
  cleanup();
  // The display time zone is a browser-wide preference; one test's choice must not
  // become the next test's browser zone.
  window.localStorage.removeItem(TIME_ZONE_STORAGE_KEY);
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
