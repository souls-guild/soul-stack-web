import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSidebar } from '../hooks/useSidebar';

describe('useSidebar', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // desktop by default
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
  });

  it('default expanded on desktop with no localStorage entry', () => {
    const { result } = renderHook(() => useSidebar());
    expect(result.current.collapsed).toBe(false);
  });

  it('default collapsed on mobile (<768px)', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 400 });
    const { result } = renderHook(() => useSidebar());
    expect(result.current.collapsed).toBe(true);
  });

  it('toggle rewrites localStorage and flips state', () => {
    const { result } = renderHook(() => useSidebar());
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    expect(window.localStorage.getItem('sidebar.collapsed')).toBe('true');
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(false);
    expect(window.localStorage.getItem('sidebar.collapsed')).toBe('false');
  });

  it('reads the operator saved value (overrides default)', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
    window.localStorage.setItem('sidebar.collapsed', 'true');
    const { result } = renderHook(() => useSidebar());
    expect(result.current.collapsed).toBe(true);
  });
});
