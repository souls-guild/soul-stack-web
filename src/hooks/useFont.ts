// useFont — hook for accessing the interface font. Throws if FontProvider is not wrapped above.
// This file contains only non-component exports — react-refresh ok.
import { useContext } from 'react';
import { FontCtx } from './fontCtxInternal';
import type { FontContextValue } from './fontCtxInternal';

export { FontProvider } from './FontContext';
export { FONT_MODES, FONT_STACKS } from './fontConstants';
export type { FontMode } from './fontConstants';

export function useFont(): FontContextValue {
  const ctx = useContext(FontCtx);
  if (!ctx) {
    throw new Error('useFont must be used inside <FontProvider>');
  }
  return ctx;
}
