import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { IncarnationRunsList } from '../pages/runs/IncarnationRunsList';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const STATS = {
  all: { total: 12, applying: 1, success: 8, failed: 2, cancelled: 1 },
  last_24h: { total: 3, applying: 1, success: 2, failed: 0, cancelled: 0 },
};

const RUNS = {
  items: [
    {
      apply_id: '01RUNAAAAAAAAAAAAAAAAAAAA1',
      incarnation: 'redis-prod',
      scenario: 'create',
      status: 'success',
      started_by_aid: 'archon-alice',
      started_at: '2026-06-30T10:00:00Z',
      finished_at: '2026-06-30T10:05:00Z',
    },
    {
      apply_id: '01RUNBBBBBBBBBBBBBBBBBBBB2',
      incarnation: 'pg-dev',
      scenario: 'restart',
      status: 'failed',
      started_at: '2026-06-30T11:00:00Z',
    },
  ],
  offset: 0,
  limit: 50,
  total: 2,
};

// fetchMock матчит по startsWith — /v1/runs/stats обязан идти РАНЬШЕ /v1/runs.
function mockAll(runs: unknown = RUNS, statsStatus = 200) {
  installFetchMock([
    { method: 'GET', url: '/v1/runs/stats', status: statsStatus, body: statsStatus === 200 ? STATS : { title: 'boom' } },
    { method: 'GET', url: '/v1/runs', body: runs },
  ]);
}

// Захват URL-ов обоих endpoint-ов (для проверки query-параметров фильтров).
function captureFetch(): { urls: string[] } {
  const captured = { urls: [] as string[] };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    captured.urls.push(url);
    const body = url.includes('/v1/runs/stats') ? STATS : RUNS;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return captured;
}

describe('IncarnationRunsList', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит прогоны из GET /v1/runs с линками на RunDetail / incarnation / archon', async () => {
    mockAll();
    renderWithProviders(<IncarnationRunsList />, '/incarnation-runs');
    await waitFor(() => expect(screen.getByText('01RUNAAAAA…')).toBeInTheDocument());

    expect(screen.getByText('01RUNAAAAA…').closest('a')).toHaveAttribute(
      'href',
      '/incarnations/redis-prod/runs/01RUNAAAAAAAAAAAAAAAAAAAA1',
    );
    expect(screen.getByRole('link', { name: 'redis-prod' })).toHaveAttribute('href', '/incarnations/redis-prod');
    expect(screen.getByRole('link', { name: 'archon-alice' })).toHaveAttribute('href', '/archons/archon-alice');
    const table = screen.getByRole('table');
    expect(within(table).getByText('restart')).toBeInTheDocument();
    expect(within(table).getByText('failed')).toBeInTheDocument();
  });

  it('шапка статистики показывает all + last_24h из GET /v1/runs/stats', async () => {
    mockAll();
    renderWithProviders(<IncarnationRunsList />, '/incarnation-runs');
    await waitFor(() => expect(screen.getByTestId('runs-stats')).toBeInTheDocument());

    const total = screen.getByTestId('runs-stat-total');
    await waitFor(() => expect(within(total).getByText('12')).toBeInTheDocument());
    expect(within(total).getByText('за 24 ч: 3')).toBeInTheDocument();
    expect(within(screen.getByTestId('runs-stat-failed')).getByText('2')).toBeInTheDocument();
  });

  it('ошибка /v1/runs/stats прячет шапку, но список живёт', async () => {
    mockAll(RUNS, 500);
    renderWithProviders(<IncarnationRunsList />, '/incarnation-runs');
    await waitFor(() => expect(screen.getByText('01RUNAAAAA…')).toBeInTheDocument());
    expect(screen.queryByTestId('runs-stats')).not.toBeInTheDocument();
  });

  it('фильтр status уходит в query как ?status=', async () => {
    const captured = captureFetch();
    renderWithProviders(<IncarnationRunsList />, '/incarnation-runs');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByTestId('runs-status-filter'), 'failed');
    await waitFor(() => {
      expect(captured.urls.some((u) => u.startsWith('/v1/runs?') && u.includes('status=failed'))).toBe(true);
    });
  });

  it('фильтр incarnation уходит в query как ?incarnation=', async () => {
    const captured = captureFetch();
    renderWithProviders(<IncarnationRunsList />, '/incarnation-runs');
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('redis-prod'), 'redis');
    await waitFor(() => {
      expect(captured.urls.some((u) => u.startsWith('/v1/runs?') && u.includes('incarnation=redis'))).toBe(true);
    });
  });

  it('Next пагинации запрашивает следующую страницу (offset=50)', async () => {
    const captured = captureFetch();
    // total > limit, чтобы Next был активен.
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      captured.urls.push(url);
      const body = url.includes('/v1/runs/stats') ? STATS : { ...RUNS, total: 120 };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    renderWithProviders(<IncarnationRunsList />, '/incarnation-runs');
    await waitFor(() => expect(screen.getByText('01RUNAAAAA…')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await waitFor(() => {
      expect(captured.urls.some((u) => u.startsWith('/v1/runs?') && u.includes('offset=50'))).toBe(true);
    });
  });

  it('пустой список без фильтров → «ещё не было прогонов» + ссылка на /run', async () => {
    mockAll({ items: [], offset: 0, limit: 50, total: 0 });
    renderWithProviders(<IncarnationRunsList />, '/incarnation-runs');
    await waitFor(() => expect(screen.getByText(/Ещё не было прогонов/)).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Запустить' })).toHaveAttribute('href', '/run');
  });
});
