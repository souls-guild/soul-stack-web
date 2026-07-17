/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, afterEach, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTranslation } from 'react-i18next';
import i18n, { DEFAULT_LANG, changeLang, SUPPORTED_LANGS } from '../i18n';
import { LangToggle } from '../components/layout/LangToggle';

// en is inline in src (bundled); ru is static in public/locales (lazy via http-backend),
// read from disk in the node test.
const EN_DIR = path.resolve('src/i18n/locales/en');
const RU_DIR = path.resolve('public/locales/ru');

function readNsKeys(dir: string, ns: string): string[] {
  const json = JSON.parse(readFileSync(path.join(dir, `${ns}.json`), 'utf-8'));
  return Object.keys(json).sort();
}

// http-backend in jsdom fetches /locales/<lng>/<ns>.json — there is no real server,
// so we serve public/locales contents from disk, otherwise changeLanguage('ru')
// never resolves.
// The stub is reinstalled in beforeEach because the global afterEach in setup.ts
// calls vi.unstubAllGlobals() after every test.
function installI18nFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const m = url.match(/\/locales\/([^/]+)\/([^/]+)\.json$/);
    if (!m) return new Response('not found', { status: 404 });
    const [, lng, ns] = m;
    const dir = path.resolve('public/locales', lng);
    try {
      const body = readFileSync(path.join(dir, `${ns}.json`), 'utf-8');
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  }));
}

beforeAll(() => { installI18nFetch(); });
beforeEach(() => { installI18nFetch(); });

afterAll(() => {
  vi.unstubAllGlobals();
});

afterEach(async () => {
  await i18n.changeLanguage(DEFAULT_LANG);
});

// Test component: action button (localized) + entity name (always English).
function Sample() {
  const { t } = useTranslation();
  return (
    <div>
      <button type="button">{t('create')}</button>
      <span data-testid="entity">Archon</span>
      <span data-testid="register">{t('register')}</span>
    </div>
  );
}

describe('i18n', () => {
  it('default locale = en: button in English (inline, no http)', () => {
    expect(i18n.resolvedLanguage).toBe('en');
    render(<Sample />);
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('entity name stays English in both locales', async () => {
    render(<Sample />);
    expect(screen.getByTestId('entity')).toHaveTextContent('Archon');
    await act(async () => { await changeLang('ru'); });
    expect(screen.getByTestId('entity')).toHaveTextContent('Archon');
    await act(async () => { await changeLang('en'); });
    expect(screen.getByTestId('entity')).toHaveTextContent('Archon');
  });

  it('changeLang switches resolvedLanguage and persists to localStorage', async () => {
    await act(async () => { await changeLang('ru'); });
    expect(i18n.resolvedLanguage).toBe('ru');
    expect(window.localStorage.getItem('lang')).toBe('ru');
    await act(async () => { await changeLang('en'); });
    expect(i18n.resolvedLanguage).toBe('en');
    expect(window.localStorage.getItem('lang')).toBe('en');
  });

  it('LangToggle: renders both buttons, en active by default, click calls changeLang', async () => {
    const user = userEvent.setup();
    render(<LangToggle />);
    const ru = screen.getByTestId('lang-ru');
    expect(screen.getByTestId('lang-en')).toHaveAttribute('aria-pressed', 'true');
    await user.click(ru);
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('ru'));
    expect(ru).toHaveAttribute('aria-pressed', 'true');
  });

  it('public ru files exist, valid JSON and key-synced with en', () => {
    const enData = i18n.getDataByLanguage('en') ?? {};
    const namespaces = Object.keys(enData);
    expect(namespaces.length).toBeGreaterThan(0);
    for (const ns of namespaces) {
      const enKeys = readNsKeys(EN_DIR, ns);
      const ruKeys = readNsKeys(RU_DIR, ns); // throws if the file is missing/broken.
      expect(ruKeys, `namespace ${ns}`).toEqual(enKeys);
    }
  });

  it('SUPPORTED_LANGS includes en and ru', () => {
    expect(SUPPORTED_LANGS).toContain('ru');
    expect(SUPPORTED_LANGS).toContain('en');
  });
});
