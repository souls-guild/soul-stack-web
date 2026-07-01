// FontProvider — провайдер шрифта интерфейса. Независим от темы (ADR: свой
// селектор, не привязан к theme mode — см. ThemeContext.tsx для паттерна).
// Этот файл экспортирует только компонент (React-refresh ok).
// Хук useFont и контекстный объект — в useFont.ts / fontCtxInternal.ts.

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { FontCtx } from './fontCtxInternal';
import { FONT_MODES, FONT_STORAGE_KEY, type FontMode } from './fontConstants';

function readStored(): FontMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = window.localStorage.getItem(FONT_STORAGE_KEY);
    if (v && (FONT_MODES as readonly string[]).includes(v)) return v as FontMode;
  } catch {
    // private mode / quota
  }
  return 'system';
}

function applyFont(mode: FontMode): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  if (mode === 'system') {
    html.removeAttribute('data-font');
  } else {
    html.setAttribute('data-font', mode);
  }
}

export function FontProvider({ children }: { children: ReactNode }) {
  const [font, setFontState] = useState<FontMode>(() => readStored());

  useEffect(() => {
    applyFont(font);
  }, [font]);

  const setFont = useCallback((next: FontMode) => {
    try {
      window.localStorage.setItem(FONT_STORAGE_KEY, next);
    } catch {
      // ignore
    }
    setFontState(next);
  }, []);

  return (
    <FontCtx.Provider value={{ font, setFont }}>
      {children}
    </FontCtx.Provider>
  );
}
