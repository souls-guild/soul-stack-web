import { useEffect, useState, useCallback } from 'react';

// localStorage `sidebar.collapsed` = 'true' | 'false'. On mobile (<768px)
// default = collapsed, on desktop — expanded. The operator's saved value
// overrides the default.

const STORAGE_KEY = 'sidebar.collapsed';
const MOBILE_BREAKPOINT = 768;

function readDefault(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch {
    // ignore
  }
  return window.innerWidth < MOBILE_BREAKPOINT;
}

export function useSidebar() {
  const [collapsed, setCollapsedState] = useState<boolean>(() => readDefault());

  // Save the operator's explicit choice.
  const setCollapsed = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // ignore
    }
    setCollapsedState(next);
  }, []);

  const toggle = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);

  // If the operator has NOT chosen explicitly — react to resize (mobile↔desktop).
  // If localStorage already has an explicit value — the operator controls it manually,
  // resize does not override it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    if (stored === 'true' || stored === 'false') return;
    const onResize = () => {
      setCollapsedState(window.innerWidth < MOBILE_BREAKPOINT);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return { collapsed, setCollapsed, toggle };
}
