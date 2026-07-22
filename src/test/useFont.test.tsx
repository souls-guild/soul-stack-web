import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useFont, FontProvider } from '../hooks/useFont';

// FontProvider — required wrapper.
function wrapper({ children }: { children: ReactNode }) {
  return <FontProvider>{children}</FontProvider>;
}

describe('useFont (context-based, independent of theme)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-font');
  });

  it('initial font = system, data-font not set', () => {
    const { result } = renderHook(() => useFont(), { wrapper });
    expect(result.current.font).toBe('system');
    expect(document.documentElement.getAttribute('data-font')).toBeNull();
  });

  it('setFont("mono") sets data-font="mono" and writes to localStorage', () => {
    const { result } = renderHook(() => useFont(), { wrapper });
    act(() => result.current.setFont('mono'));
    expect(result.current.font).toBe('mono');
    expect(document.documentElement.getAttribute('data-font')).toBe('mono');
    expect(window.localStorage.getItem('app-font')).toBe('mono');
  });

  it('setFont("serif") sets data-font="serif"', () => {
    const { result } = renderHook(() => useFont(), { wrapper });
    act(() => result.current.setFont('mono'));
    act(() => result.current.setFont('serif'));
    expect(result.current.font).toBe('serif');
    expect(document.documentElement.getAttribute('data-font')).toBe('serif');
  });

  it.each(['manrope', 'quicksand', 'unbounded', 'caveat', 'comfortaa', 'comic-neue'] as const)(
    'setFont("%s") sets the corresponding data-font',
    (mode) => {
      const { result } = renderHook(() => useFont(), { wrapper });
      act(() => result.current.setFont(mode));
      expect(result.current.font).toBe(mode);
      expect(document.documentElement.getAttribute('data-font')).toBe(mode);
      expect(window.localStorage.getItem('app-font')).toBe(mode);
    },
  );

  it('setFont("system") after a non-default font clears data-font (returns to default)', () => {
    const { result } = renderHook(() => useFont(), { wrapper });
    act(() => result.current.setFont('unbounded'));
    act(() => result.current.setFont('system'));
    expect(result.current.font).toBe('system');
    expect(document.documentElement.getAttribute('data-font')).toBeNull();
  });

  it('useFont without a provider throws an error', () => {
    expect(() => renderHook(() => useFont())).toThrow('useFont must be used inside <FontProvider>');
  });

  it('initializes as unbounded when localStorage("app-font")="unbounded"', () => {
    window.localStorage.setItem('app-font', 'unbounded');
    const { result } = renderHook(() => useFont(), { wrapper });
    expect(result.current.font).toBe('unbounded');
  });

  it('invalid localStorage value is ignored, falls back to system', () => {
    window.localStorage.setItem('app-font', 'comic-sans-does-not-exist');
    const { result } = renderHook(() => useFont(), { wrapper });
    expect(result.current.font).toBe('system');
  });
});
