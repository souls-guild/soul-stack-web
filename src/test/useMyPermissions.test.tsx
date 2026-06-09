import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMyPermissions } from '../hooks/useMyPermissions';
import { tokenStore } from '../api/tokenStore';

/**
 * Guard-тест инварианта: при ошибке /v1/me/permissions (403/500)
 * hasPermission возвращает true (optimistic/graceful-degradation).
 *
 * Осознанный инвариант: кнопки остаются enabled при недоступном эндпоинте.
 * Авторизация — ответственность backend (он даст 403 при фактическом вызове).
 * Регресс на `return false` приведёт к тому, что все кнопки молча скрываются/
 * дизейблятся при любом сбое прав — UX-хуже-чем-сейчас без явного сообщения об ошибке.
 */

function wrapper(qc: QueryClient) {
  return function Wrap({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function makeQC() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
}

describe('useMyPermissions — optimistic-enable инвариант', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('[ИНВАРИАНТ] при 403 /v1/me/permissions hasPermission("synod.create") возвращает true', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ type: 'about:blank', title: 'Forbidden', status: 403, detail: 'forbidden' }),
        { status: 403, headers: { 'Content-Type': 'application/problem+json' } },
      )) as typeof fetch;

    const qc = makeQC();
    const { result } = renderHook(() => useMyPermissions(), { wrapper: wrapper(qc) });

    // Пока грузим — тоже true (optimistic).
    expect(result.current.hasPermission('synod.create')).toBe(true);

    // После получения ошибки — по-прежнему true.
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasPermission('synod.create')).toBe(true);
    expect(result.current.hasPermission('soul.list')).toBe(true);
  });

  it('[ИНВАРИАНТ] при 500 /v1/me/permissions hasPermission возвращает true', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ type: 'about:blank', title: 'Error', status: 500, detail: 'internal' }),
        { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
      )) as typeof fetch;

    const qc = makeQC();
    const { result } = renderHook(() => useMyPermissions(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasPermission('synod.delete')).toBe(true);
  });

  it('[БАЗОВАЯ] при успешном ответе без нужного права hasPermission возвращает false', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          permissions: [{ wildcard: false, resource: 'soul', action: 'list' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;

    const qc = makeQC();
    const { result } = renderHook(() => useMyPermissions(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasPermission('synod.create')).toBe(false);
    expect(result.current.hasPermission('soul.list')).toBe(true);
  });

  it('[БАЗОВАЯ] wildcard=true → hasPermission всегда true', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ permissions: [{ wildcard: true }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;

    const qc = makeQC();
    const { result } = renderHook(() => useMyPermissions(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasPermission('synod.create')).toBe(true);
    expect(result.current.hasPermission('anything.else')).toBe(true);
  });
});
