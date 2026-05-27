import { useEffect, useState, useCallback } from 'react';

// localStorage `sidebar.collapsed` = 'true' | 'false'. На mobile (<768px)
// default = collapsed, на desktop — expanded. Сохранённое значение оператора
// перекрывает default.

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

  // Сохраняем явный выбор оператора.
  const setCollapsed = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // ignore
    }
    setCollapsedState(next);
  }, []);

  const toggle = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);

  // Если оператор НЕ выбирал явно — реагируем на resize (mobile↔desktop).
  // Если localStorage уже содержит явное значение — оператор управляет вручную,
  // resize не перетирает.
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
