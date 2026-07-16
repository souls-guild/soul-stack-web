import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMyPermissions } from '../hooks/useMyPermissions';
import { tokenStore } from '../api/tokenStore';

/**
 * Guard test for the invariant: on /v1/me/permissions error (403/500)
 * hasPermission returns true (optimistic/graceful-degradation).
 *
 * Deliberate invariant: buttons stay enabled when the endpoint is unavailable.
 * Authorization is the backend's responsibility (it returns 403 on the actual call).
 * A regression to `return false` would silently hide/disable all buttons on any
 * permission-check failure — worse UX than now, with no explicit error message.
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
    vi.stubGlobal('fetch', async () =>
      new Response(
        JSON.stringify({ type: 'about:blank', title: 'Forbidden', status: 403, detail: 'forbidden' }),
        { status: 403, headers: { 'Content-Type': 'application/problem+json' } },
      ));

    const qc = makeQC();
    const { result } = renderHook(() => useMyPermissions(), { wrapper: wrapper(qc) });

    // While loading — also true (optimistic).
    expect(result.current.hasPermission('synod.create')).toBe(true);

    // After getting the error — still true.
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasPermission('synod.create')).toBe(true);
    expect(result.current.hasPermission('soul.list')).toBe(true);
  });

  it('[ИНВАРИАНТ] при 500 /v1/me/permissions hasPermission возвращает true', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(
        JSON.stringify({ type: 'about:blank', title: 'Error', status: 500, detail: 'internal' }),
        { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
      ));

    const qc = makeQC();
    const { result } = renderHook(() => useMyPermissions(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasPermission('synod.delete')).toBe(true);
  });

  it('[БАЗОВАЯ] при успешном ответе без нужного права hasPermission возвращает false', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(
        JSON.stringify({
          permissions: [{ wildcard: false, resource: 'soul', action: 'list' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));

    const qc = makeQC();
    const { result } = renderHook(() => useMyPermissions(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasPermission('synod.create')).toBe(false);
    expect(result.current.hasPermission('soul.list')).toBe(true);
  });

  it('[БАЗОВАЯ] wildcard=true → hasPermission всегда true', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(
        JSON.stringify({ permissions: [{ wildcard: true }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));

    const qc = makeQC();
    const { result } = renderHook(() => useMyPermissions(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasPermission('synod.create')).toBe(true);
    expect(result.current.hasPermission('anything.else')).toBe(true);
  });
});
