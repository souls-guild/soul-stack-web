// FontProvider - the interface font provider. Independent of theme (ADR: its own
// selector, not tied to theme mode - see ThemeContext.tsx for the pattern).
// This file exports only the component (React-refresh ok).
// The useFont hook and context object are in useFont.ts / fontCtxInternal.ts.

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
