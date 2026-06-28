// useTheme — хук доступа к теме. Бросает, если ThemeProvider не обёрнут выше.
// Этот файл содержит только не-компонентные экспорты — react-refresh ok.
import { useContext } from 'react';
import { ThemeCtx } from './themeCtxInternal';
import type { ThemeContextValue } from './themeCtxInternal';

export { ThemeProvider } from './ThemeContext';
export { THEME_MODES } from './themeConstants';
export type { ThemeMode } from './themeConstants';

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeCtx);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}
