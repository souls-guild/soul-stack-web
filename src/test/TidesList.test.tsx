import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { TidesList } from '../pages/tides/TidesList';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const SAMPLE_PAGE = {
  items: [
    {
      tide_id: '01HZAA0000000000000000000T',
      incarnation_name: 'redis-prod-eu',
      scenario_name: 'rolling-restart',
      status: 'running',
      total_surges: 5,
      current_surge_index: 2,
      surge_size: 20,
      scope_size: 100,
      on_surge_failure: 'abort',
      attempt: 1,
      started_by_aid: 'archon-alice',
      started_at: '2026-05-27T12:00:00Z',
    },
    {
      tide_id: '01HZAA0000000000000000000U',
      incarnation_name: 'kafka-eu',
      scenario_name: 'add-broker',
      status: 'succeeded',
      total_surges: 2,
      current_surge_index: 2,
      surge_size: 5,
      scope_size: 10,
      on_surge_failure: 'continue',
      attempt: 1,
      started_by_aid: 'archon-bob',
      started_at: '2026-05-27T11:00:00Z',
      finished_at: '2026-05-27T11:05:00Z',
    },
  ],
  offset: 0,
  limit: 50,
  total: 2,
};

describe('TidesList', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит список Tide-прогонов', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/tides', body: SAMPLE_PAGE },
    ]);
    renderWithProviders(<TidesList />, '/tides');
    await waitFor(() => {
      expect(screen.getByText('redis-prod-eu')).toBeInTheDocument();
      expect(screen.getByText('kafka-eu')).toBeInTheDocument();
    });
    // status — chip-кнопка + badge → используем getAllByText
    expect(screen.getAllByText('running').length).toBeGreaterThan(0);
    expect(screen.getAllByText('succeeded').length).toBeGreaterThan(0);
    // progress 2/5
    expect(screen.getByText('2/5')).toBeInTheDocument();
  });

  it('incarnation filter уходит в query как ?incarnation=', async () => {
    let lastUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      lastUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    renderWithProviders(<TidesList />, '/tides');
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('redis-prod-eu'), 'kafka');
    await waitFor(() => {
      expect(lastUrl).toMatch(/incarnation=kafka/);
    });
  });

  it('status chip toggle добавляет multi-value ?status= в query', async () => {
    let lastUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      lastUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    renderWithProviders(<TidesList />, '/tides');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'running' }));
    await user.click(screen.getByRole('button', { name: 'failed' }));
    await waitFor(() => {
      expect(lastUrl).toMatch(/status=running/);
      expect(lastUrl).toMatch(/status=failed/);
    });
  });
});
