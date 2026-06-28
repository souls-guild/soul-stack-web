// Внутренний createContext — вынесен из ThemeContext.tsx чтобы не было
// lint-warning react-refresh/only-export-components (файл с провайдером
// должен экспортировать только компоненты).
import { createContext } from 'react';
import type { ThemeMode } from './themeConstants';

export interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (next: ThemeMode) => void;
}

export const ThemeCtx = createContext<ThemeContextValue | null>(null);
