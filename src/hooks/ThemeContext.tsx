// ThemeProvider - the theme provider.
// This file exports only the component (React-refresh ok).
// The useTheme hook and context object are in useTheme.ts / themeCtxInternal.ts.

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { ThemeCtx } from './themeCtxInternal';
import { THEME_MODES, THEME_STORAGE_KEY, type ThemeMode } from './themeConstants';

function readStored(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (v && (THEME_MODES as readonly string[]).includes(v)) return v as ThemeMode;
  } catch {
    // private mode / quota
  }
  return 'system';
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  if (mode === 'system') {
    if (systemPrefersDark()) {
      html.setAttribute('data-theme', 'dark');
    } else {
      html.removeAttribute('data-theme');
    }
  } else {
    html.setAttribute('data-theme', mode);
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStored());

  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

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
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // ignore
    }
    setModeState(next);
  }, []);

  return (
    <ThemeCtx.Provider value={{ mode, setMode }}>
      {children}
    </ThemeCtx.Provider>
  );
}
