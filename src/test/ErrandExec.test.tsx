import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { ErrandExec } from '../pages/errand/ErrandExec';
import { tokenStore } from '../api/tokenStore';

const SYNC_RESULT = {
  errand_id: '01HZAA0000000000000000000B',
  sid: 'host01.example.com',
  module: 'core.cmd.shell',
  status: 'success' as const,
  exit_code: 0,
  stdout: 'hello\n',
  duration_ms: 42,
  started_by_aid: 'archon-alice',
  started_at: '2026-05-26T10:00:00Z',
  finished_at: '2026-05-26T10:00:00Z',
};

describe('ErrandExec', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('sync 200 → рендерит ErrandResult', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && url.includes('/v1/souls/') && url.includes('/exec')) {
        return new Response(JSON.stringify(SYNC_RESULT), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    renderWithProviders(<ErrandExec />, '/errand/exec');
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/host01.example.com/i), 'host01.example.com');
    await user.click(screen.getByRole('button', { name: /Run/i }));

    await waitFor(() => {
      expect(screen.getAllByText('success').length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/01HZAA0000000000000000000B/)).toBeInTheDocument();
    expect(screen.getByText(/hello/)).toBeInTheDocument();
  });

  it('async 202 → poll до терминала', async () => {
    let polls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && url.includes('/exec')) {
        return new Response(
          JSON.stringify({ errand_id: '01HZAA0000000000000000000C', status: 'running' }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (method === 'GET' && url.includes('/v1/errands/01HZAA0000000000000000000C')) {
        polls += 1;
        if (polls === 1) {
          return new Response(
            JSON.stringify({ errand_id: '01HZAA0000000000000000000C', status: 'running' }),
            { status: 202, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            ...SYNC_RESULT,
            errand_id: '01HZAA0000000000000000000C',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    renderWithProviders(<ErrandExec />, '/errand/exec');
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/host01.example.com/i), 'host02');
    await user.click(screen.getByRole('button', { name: /Run/i }));

    await waitFor(() => {
      expect(screen.getByText(/Async polling/i)).toBeInTheDocument();
    });
    await waitFor(
      () => {
        expect(screen.getAllByText('success').length).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );
  });
});
