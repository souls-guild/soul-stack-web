import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useFont, FontProvider } from '../hooks/useFont';

// FontProvider — required wrapper.
function wrapper({ children }: { children: ReactNode }) {
  return <FontProvider>{children}</FontProvider>;
}

describe('useFont (context-based, независим от темы)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-font');
  });

  it('initial font = system, data-font не выставлен', () => {
    const { result } = renderHook(() => useFont(), { wrapper });
    expect(result.current.font).toBe('system');
    expect(document.documentElement.getAttribute('data-font')).toBeNull();
  });

  it('setFont("mono") выставляет data-font="mono" и пишет в localStorage', () => {
    const { result } = renderHook(() => useFont(), { wrapper });
    act(() => result.current.setFont('mono'));
    expect(result.current.font).toBe('mono');
    expect(document.documentElement.getAttribute('data-font')).toBe('mono');
    expect(window.localStorage.getItem('app-font')).toBe('mono');
  });

  it('setFont("serif") выставляет data-font="serif"', () => {
    const { result } = renderHook(() => useFont(), { wrapper });
    act(() => result.current.setFont('mono'));
    act(() => result.current.setFont('serif'));
    expect(result.current.font).toBe('serif');
    expect(document.documentElement.getAttribute('data-font')).toBe('serif');
  });

  it.each(['manrope', 'quicksand', 'unbounded', 'caveat', 'comfortaa', 'comic-neue'] as const)(
    'setFont("%s") выставляет соответствующий data-font',
    (mode) => {
      const { result } = renderHook(() => useFont(), { wrapper });
      act(() => result.current.setFont(mode));
      expect(result.current.font).toBe(mode);
      expect(document.documentElement.getAttribute('data-font')).toBe(mode);
      expect(window.localStorage.getItem('app-font')).toBe(mode);
    },
  );

  it('setFont("system") после нестандартного шрифта снимает data-font (возврат к дефолту)', () => {
    const { result } = renderHook(() => useFont(), { wrapper });
    act(() => result.current.setFont('unbounded'));
    act(() => result.current.setFont('system'));
    expect(result.current.font).toBe('system');
    expect(document.documentElement.getAttribute('data-font')).toBeNull();
  });

  it('useFont без провайдера бросает ошибку', () => {
    expect(() => renderHook(() => useFont())).toThrow('useFont must be used inside <FontProvider>');
  });

  it('при localStorage("app-font")="unbounded" инициализируется как unbounded', () => {
    window.localStorage.setItem('app-font', 'unbounded');
    const { result } = renderHook(() => useFont(), { wrapper });
    expect(result.current.font).toBe('unbounded');
  });

  it('невалидное значение localStorage игнорируется, откат на system', () => {
    window.localStorage.setItem('app-font', 'comic-sans-does-not-exist');
    const { result } = renderHook(() => useFont(), { wrapper });
    expect(result.current.font).toBe('system');
  });
});
