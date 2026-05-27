import { useEffect, useState, useCallback } from 'react';

// 3 режима по ТЗ: light / dark / system. Применяем через data-theme="dark"
// на <html> — это уже подключено в tokens.css (см. блок [data-theme="dark"]).
// 'system' слушает matchMedia('(prefers-color-scheme: dark)').

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme';

function readStored(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === 'light' || v === 'dark' || v === 'system') return v;
  return 'system';
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const effectiveDark = mode === 'dark' || (mode === 'system' && systemPrefersDark());
  if (effectiveDark) {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => readStored());

  // Apply на mount + при смене mode.
  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

  // В режиме system — слушаем смену OS-темы.
  useEffect(() => {
    if (mode !== 'system') return;
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage может быть недоступен (private mode / quota) — игнор.
    }
    setModeState(next);
  }, []);

  return { mode, setMode };
}
