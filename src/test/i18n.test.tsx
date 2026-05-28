import { describe, it, expect, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTranslation } from 'react-i18next';
import i18n, { DEFAULT_LANG, changeLang } from '../i18n';
import { LangToggle } from '../components/layout/LangToggle';

afterEach(() => {
  void i18n.changeLanguage(DEFAULT_LANG);
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
  it('default-locale = ru: кнопка по-русски', () => {
    expect(i18n.resolvedLanguage).toBe('ru');
    render(<Sample />);
    expect(screen.getByRole('button', { name: 'Создать' })).toBeInTheDocument();
  });

  it('changeLang(en): кнопка переключается на English', async () => {
    render(<Sample />);
    await act(async () => { changeLang('en'); });
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('имя сущности остаётся English в обоих locale', async () => {
    render(<Sample />);
    expect(screen.getByTestId('entity')).toHaveTextContent('Archon');
    await act(async () => { changeLang('en'); });
    expect(screen.getByTestId('entity')).toHaveTextContent('Archon');
    await act(async () => { changeLang('ru'); });
    expect(screen.getByTestId('entity')).toHaveTextContent('Archon');
  });

  it('English-identical ключ (register) одинаков в ru и en', async () => {
    render(<Sample />);
    expect(screen.getByTestId('register')).toHaveTextContent('Register');
    await act(async () => { changeLang('en'); });
    expect(screen.getByTestId('register')).toHaveTextContent('Register');
  });

  it('LangToggle: клик по EN меняет язык и помечает кнопку активной', async () => {
    const user = userEvent.setup();
    render(<LangToggle />);
    const en = screen.getByTestId('lang-en');
    expect(screen.getByTestId('lang-ru')).toHaveAttribute('aria-pressed', 'true');
    await user.click(en);
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('en'));
    expect(en).toHaveAttribute('aria-pressed', 'true');
  });

  it('changeLang persist в localStorage', async () => {
    await act(async () => { changeLang('en'); });
    expect(window.localStorage.getItem('lang')).toBe('en');
    await act(async () => { changeLang('ru'); });
    expect(window.localStorage.getItem('lang')).toBe('ru');
  });

  it('locale-файлы: ключи ru и en синхронизированы (нет осиротевших)', () => {
    const ru = i18n.getDataByLanguage('ru') ?? {};
    const en = i18n.getDataByLanguage('en') ?? {};
    for (const ns of Object.keys(ru)) {
      const ruKeys = Object.keys((ru as Record<string, object>)[ns] ?? {}).sort();
      const enKeys = Object.keys((en as Record<string, object>)[ns] ?? {}).sort();
      expect(enKeys, `namespace ${ns}`).toEqual(ruKeys);
    }
  });
});
