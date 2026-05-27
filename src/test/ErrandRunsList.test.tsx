import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { ErrandRunsList } from '../pages/errandRuns/ErrandRunsList';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const SAMPLE_PAGE = {
  items: [
    {
      errand_run_id: 'er-01HZAA0000000000000000000A',
      module: 'core.cmd.shell',
      status: 'success',
      scope_size: 3,
      current_done: 3,
      started_at: '2026-05-27T10:00:00Z',
      finished_at: '2026-05-27T10:00:30Z',
      target_preview: 'coven=[prod]',
    },
    {
      errand_run_id: 'er-01HZAA0000000000000000000B',
      module: 'core.exec.run',
      status: 'running',
      scope_size: 50,
      current_done: 12,
      started_at: '2026-05-27T11:00:00Z',
      target_preview: 'sid.glob("db-*")',
    },
  ],
  offset: 0,
  limit: 50,
  total: 2,
};

describe('ErrandRunsList', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит список errand-run-ов', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/errand-runs', body: SAMPLE_PAGE },
    ]);
    renderWithProviders(<ErrandRunsList />, '/errand-runs');
    await waitFor(() => {
      expect(screen.getByText('core.cmd.shell')).toBeInTheDocument();
    });
    expect(screen.getByText('core.exec.run')).toBeInTheDocument();
    expect(screen.getByText('coven=[prod]')).toBeInTheDocument();
    expect(screen.getAllByText('success').length).toBeGreaterThan(1);
    expect(screen.getAllByText('running').length).toBeGreaterThan(1);
  });

  it('module CSV filter уходит в query как multi-value', async () => {
    let lastUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      lastUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    renderWithProviders(<ErrandRunsList />, '/errand-runs');
    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText(/core.cmd.shell, core.exec.run/),
      'core.cmd.shell',
    );
    await waitFor(() => {
      expect(lastUrl).toMatch(/module=core\.cmd\.shell/);
    });
  });

  it('status chip multi-select добавляет ?status= повторно', async () => {
    let lastUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      lastUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    renderWithProviders(<ErrandRunsList />, '/errand-runs');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'success' }));
    await user.click(screen.getByRole('button', { name: 'failed' }));
    await waitFor(() => {
      expect(lastUrl).toMatch(/status=success/);
      expect(lastUrl).toMatch(/status=failed/);
    });
  });
});
