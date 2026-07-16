// Internal createContext - extracted from FontContext.tsx to avoid the
// react-refresh/only-export-components lint-warning (a file with a provider
// must export only components). See themeCtxInternal.ts (symmetry).
import { createContext } from 'react';
import type { FontMode } from './fontConstants';

export interface FontContextValue {
  font: FontMode;
  setFont: (next: FontMode) => void;
}

export const FontCtx = createContext<FontContextValue | null>(null);
