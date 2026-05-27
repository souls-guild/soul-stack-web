import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from '../hooks/useTheme';

describe('useTheme', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    // jsdom по умолчанию matchMedia не реализует — мокаем.
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

  it('initial mode = system, data-theme не выставлен (system→light в моке)', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe('system');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('setMode("dark") выставляет data-theme="dark" и пишет в localStorage', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode('dark'));
    expect(result.current.mode).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('theme')).toBe('dark');
  });

  it('setMode("light") снимает data-theme', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode('dark'));
    act(() => result.current.setMode('light'));
    expect(result.current.mode).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });
});
