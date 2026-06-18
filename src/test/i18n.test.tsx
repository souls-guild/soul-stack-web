/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, afterEach, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTranslation } from 'react-i18next';
import i18n, { DEFAULT_LANG, changeLang, SUPPORTED_LANGS } from '../i18n';
import { LangToggle } from '../components/layout/LangToggle';

// ru — inline в src (bundled); en — static в public/locales (lazy через http-backend),
// в node-тесте читается с диска.
const RU_DIR = path.resolve('src/i18n/locales/ru');
const EN_DIR = path.resolve('public/locales/en');

function readNsKeys(dir: string, ns: string): string[] {
  const json = JSON.parse(readFileSync(path.join(dir, `${ns}.json`), 'utf-8'));
  return Object.keys(json).sort();
}

// http-backend в jsdom фетчит /locales/<lng>/<ns>.json — реального сервера нет,
// поэтому отдаём содержимое public/locales с диска, иначе changeLanguage('en')
// никогда не резолвится.
// Стаб переустанавливается в beforeEach, т.к. глобальный afterEach из setup.ts
// вызывает vi.unstubAllGlobals() после каждого теста.
function installI18nFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const m = url.match(/\/locales\/([^/]+)\/([^/]+)\.json$/);
    if (!m) return new Response('not found', { status: 404 });
    const [, lng, ns] = m;
    const dir = lng === 'ru' ? RU_DIR : path.resolve('public/locales', lng);
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

// Тестовый компонент: кнопка-действие (локализуется) + имя сущности (English всегда).
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
  it('default-locale = ru: кнопка по-русски (inline, без http)', () => {
    expect(i18n.resolvedLanguage).toBe('ru');
    render(<Sample />);
    expect(screen.getByRole('button', { name: 'Создать' })).toBeInTheDocument();
  });

  it('имя сущности остаётся English в обоих locale', async () => {
    render(<Sample />);
    expect(screen.getByTestId('entity')).toHaveTextContent('Archon');
    await act(async () => { await changeLang('en'); });
    expect(screen.getByTestId('entity')).toHaveTextContent('Archon');
    await act(async () => { await changeLang('ru'); });
    expect(screen.getByTestId('entity')).toHaveTextContent('Archon');
  });

  it('changeLang переключает resolvedLanguage и persist в localStorage', async () => {
    await act(async () => { await changeLang('en'); });
    expect(i18n.resolvedLanguage).toBe('en');
    expect(window.localStorage.getItem('lang')).toBe('en');
    await act(async () => { await changeLang('ru'); });
    expect(i18n.resolvedLanguage).toBe('ru');
    expect(window.localStorage.getItem('lang')).toBe('ru');
  });

  it('LangToggle: рендерит обе кнопки, ru активна по default, клик зовёт changeLang', async () => {
    const user = userEvent.setup();
    render(<LangToggle />);
    const en = screen.getByTestId('lang-en');
    expect(screen.getByTestId('lang-ru')).toHaveAttribute('aria-pressed', 'true');
    await user.click(en);
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('en'));
    expect(en).toHaveAttribute('aria-pressed', 'true');
  });

  it('public en-файлы существуют, валидный JSON и ключ-синхронны с ru', () => {
    const ruData = i18n.getDataByLanguage('ru') ?? {};
    const namespaces = Object.keys(ruData);
    expect(namespaces.length).toBeGreaterThan(0);
    for (const ns of namespaces) {
      const ruKeys = readNsKeys(RU_DIR, ns);
      const enKeys = readNsKeys(EN_DIR, ns); // бросит, если файл отсутствует/битый.
      expect(enKeys, `namespace ${ns}`).toEqual(ruKeys);
    }
  });

  it('SUPPORTED_LANGS включает ru и en', () => {
    expect(SUPPORTED_LANGS).toContain('ru');
    expect(SUPPORTED_LANGS).toContain('en');
  });
});
