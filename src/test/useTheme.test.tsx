import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useTheme, ThemeProvider } from '../hooks/useTheme';

// ThemeProvider — required wrapper.
function wrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe('useTheme (context-based)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    // jsdom does not implement matchMedia by default — we mock it.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      })),
    });
  });

  it('initial mode = system, data-theme not set (system→light in the mock)', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.mode).toBe('system');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('setMode("dark") sets data-theme="dark" and writes to localStorage', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setMode('dark'));
    expect(result.current.mode).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('theme')).toBe('dark');
  });

  it('setMode("light") sets data-theme="light"', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setMode('dark'));
    act(() => result.current.setMode('light'));
    expect(result.current.mode).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('setMode("warm") sets data-theme="warm"', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setMode('warm'));
    expect(result.current.mode).toBe('warm');
    expect(document.documentElement.getAttribute('data-theme')).toBe('warm');
    expect(window.localStorage.getItem('theme')).toBe('warm');
  });

  it('setMode("deep") sets data-theme="deep"', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setMode('deep'));
    expect(result.current.mode).toBe('deep');
    expect(document.documentElement.getAttribute('data-theme')).toBe('deep');
    expect(window.localStorage.getItem('theme')).toBe('deep');
  });

  it('useTheme without a provider throws an error', () => {
    // useTheme outside ThemeProvider should throw.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useTheme())).toThrow('useTheme must be used inside <ThemeProvider>');
    consoleError.mockRestore();
  });

  it('initializes as dark when localStorage="dark"', () => {
    window.localStorage.setItem('theme', 'dark');
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.mode).toBe('dark');
  });
});
