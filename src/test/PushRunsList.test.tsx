import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { PushRunsList } from '../pages/pushRuns/PushRunsList';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const SAMPLE_PAGE = {
  items: [
    {
      apply_id: '01HZBB0000000000000000000P',
      inventory_sids: ['host01', 'host02', 'host03'],
      destiny_ref: 'redis-cluster@v2.0.0',
      ssh_provider: 'default',
      cleanup_stale: false,
      status: 'success',
      started_at: '2026-05-27T12:00:00Z',
      finished_at: '2026-05-27T12:02:00Z',
      started_by_aid: 'archon-alice',
      summary_counts: { total: 3, success_count: 3, fail_count: 0 },
    },
    {
      apply_id: '01HZBB0000000000000000000Q',
      inventory_sids: ['host04'],
      destiny_ref: 'kafka@main',
      cleanup_stale: true,
      status: 'failed',
      started_at: '2026-05-27T11:00:00Z',
      finished_at: '2026-05-27T11:01:00Z',
      started_by_aid: 'archon-bob',
      summary_counts: { total: 1, success_count: 0, fail_count: 1 },
    },
  ],
  offset: 0,
  limit: 50,
  total: 2,
};

describe('PushRunsList', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('рендерит список push-прогонов', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/push-runs', body: SAMPLE_PAGE },
    ]);
    renderWithProviders(<PushRunsList />, '/push-runs');
    // 'routing' — fallback при пустом ssh_provider, появляется только в cell-е
    // (не в chip-фильтрах) → надёжный маркер того, что table отрендерился.
    await waitFor(() => {
      expect(screen.getByText('routing')).toBeInTheDocument();
    });
    expect(screen.getByText('redis-cluster@v2.0.0')).toBeInTheDocument();
    expect(screen.getByText('kafka@main')).toBeInTheDocument();
    // status встречается и в chip-кнопках, и в badge-ах cell-а → берём all.
    expect(screen.getAllByText('success').length).toBeGreaterThan(1);
    expect(screen.getAllByText('failed').length).toBeGreaterThan(1);
  });

  it('ssh_provider filter уходит в query как ?ssh_provider=', async () => {
    let lastUrl = '';
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      lastUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    renderWithProviders(<PushRunsList />, '/push-runs');
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('default'), 'aws-bastion');
    await waitFor(() => {
      expect(lastUrl).toMatch(/ssh_provider=aws-bastion/);
    });
  });

  it('status chip multi-select добавляет ?status= повторно', async () => {
    let lastUrl = '';
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      lastUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    renderWithProviders(<PushRunsList />, '/push-runs');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'success' }));
    await user.click(screen.getByRole('button', { name: 'failed' }));
    await waitFor(() => {
      expect(lastUrl).toMatch(/status=success/);
      expect(lastUrl).toMatch(/status=failed/);
    });
  });
});
