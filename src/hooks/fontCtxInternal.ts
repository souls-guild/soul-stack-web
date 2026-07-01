// Внутренний createContext — вынесен из FontContext.tsx чтобы не было
// lint-warning react-refresh/only-export-components (файл с провайдером
// должен экспортировать только компоненты). См. themeCtxInternal.ts (симметрия).
import { createContext } from 'react';
import type { FontMode } from './fontConstants';

export interface FontContextValue {
  font: FontMode;
  setFont: (next: FontMode) => void;
}

export const FontCtx = createContext<FontContextValue | null>(null);
