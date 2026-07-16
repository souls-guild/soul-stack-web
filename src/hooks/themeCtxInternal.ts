// Internal createContext - extracted from ThemeContext.tsx to avoid the
// react-refresh/only-export-components lint-warning (a file with a provider
// must export only components).
import { createContext } from 'react';
import type { ThemeMode } from './themeConstants';

export interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (next: ThemeMode) => void;
}

export const ThemeCtx = createContext<ThemeContextValue | null>(null);
