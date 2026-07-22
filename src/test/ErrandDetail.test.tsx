import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ErrandDetail } from '../pages/errands/ErrandDetail';
import { tokenStore } from '../api/tokenStore';

function renderAt(initialPath: string) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrap({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(
    <Routes>
      <Route path="/errands/:id" element={<ErrandDetail />} />
    </Routes>,
    { wrapper: Wrap },
  );
}

const TERMINAL_RESULT = {
  errand_id: '01HZAA0000000000000000000B',
  sid: 'host01',
  module: 'core.cmd.shell',
  status: 'success' as const,
  exit_code: 0,
  stdout: 'hello\nworld',
  stderr: '',
  duration_ms: 42,
  started_by_aid: 'archon-alice',
  started_at: '2026-05-26T10:00:00Z',
  finished_at: '2026-05-26T10:00:00Z',
};

describe('ErrandDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  it('renders meta + stdout in the Output tab', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/v1/errands/')) {
        return new Response(JSON.stringify(TERMINAL_RESULT), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    });

    renderAt('/errands/01HZAA0000000000000000000B');
    await waitFor(() => {
      expect(screen.getByText('core.cmd.shell')).toBeInTheDocument();
      expect(screen.getByText('host01')).toBeInTheDocument();
      expect(screen.getByText(/hello/)).toBeInTheDocument();
      expect(screen.getAllByText('success').length).toBeGreaterThan(0);
    });
  });

  it('Events tab shows started/finished', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify(TERMINAL_RESULT), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    renderAt('/errands/01HZAA0000000000000000000B');
    await waitFor(() => {
      expect(screen.getByText(/hello/)).toBeInTheDocument();
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Events/i }));
    await waitFor(() => {
      // started/finished badge tones are contained in the timeline.
      expect(screen.getByText('started')).toBeInTheDocument();
      expect(screen.getByText('finished')).toBeInTheDocument();
    });
  });

  it('running → 202 polling, no stdout', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ errand_id: 'x', status: 'running' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }));
    renderAt('/errands/01HZAA0000000000000000000C');
    await waitFor(() => {
      expect(screen.getByText(/polling/i)).toBeInTheDocument();
    });
  });
});
