import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ErrandRunDetail } from '../pages/errandRuns/ErrandRunDetail';
import { tokenStore } from '../api/tokenStore';

function renderDetail(id: string) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrap({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/errand-runs/${id}`]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(
    <Routes>
      <Route path="/errand-runs/:id" element={<ErrandRunDetail />} />
    </Routes>,
    { wrapper: Wrap },
  );
}

const SAMPLE_VIEW = {
  errand_run_id: 'er-01HZAA00',
  module: 'core.cmd.shell',
  status: 'success' as const,
  scope_size: 3,
  current_done: 3,
  concurrency: 50,
  on_failure: 'abort' as const,
  target: { coven: ['prod'] },
  started_by_aid: 'archon-alice',
  started_at: '2026-05-27T10:00:00Z',
  finished_at: '2026-05-27T10:00:30Z',
  summary: {
    counts: { total: 3, success: 3, failed: 0 },
    hosts: [
      { sid: 'host01', status: 'success', errand_id: 'errand-001' },
      { sid: 'host02', status: 'success', errand_id: 'errand-002' },
      { sid: 'host03', status: 'failed', error_code: 'TIMEOUT' },
    ],
  },
};

describe('ErrandRunDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
    // @ts-expect-error — jsdom не имеет EventSource.
    globalThis.EventSource = class {
      readyState = 0;
      onopen: ((ev: Event) => void) | null = null;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      close() {
        /* noop */
      }
      static OPEN = 1;
      static CONNECTING = 0;
      static CLOSED = 2;
    };
  });

  it('terminal: meta + per-host table рендерится', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/v1/errand-runs/')) {
        return new Response(JSON.stringify(SAMPLE_VIEW), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    renderDetail('er-01HZAA00');
    await waitFor(() => {
      expect(screen.getByText('core.cmd.shell')).toBeInTheDocument();
    });
    expect(screen.getByText('host01')).toBeInTheDocument();
    expect(screen.getByText('host03')).toBeInTheDocument();
    expect(screen.getByText('TIMEOUT')).toBeInTheDocument();
    // Terminal → нет Cancel кнопки.
    expect(screen.queryByRole('button', { name: /Cancel/ })).not.toBeInTheDocument();
  });

  it('running: показывает Cancel-кнопку', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/v1/errand-runs/')) {
        return new Response(
          JSON.stringify({ ...SAMPLE_VIEW, status: 'running', finished_at: undefined }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    renderDetail('er-01HZAA00');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument();
    });
  });
});
