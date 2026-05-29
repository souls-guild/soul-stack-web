import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { RunsFeed } from '../pages/runs/RunsFeed';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const TIDES = {
  items: [
    {
      tide_id: '01TIDE00000000000000000001',
      incarnation_name: 'redis-prod',
      scenario_name: 'rolling-restart',
      status: 'running',
      total_surges: 3,
      current_surge_index: 1,
      surge_size: 10,
      scope_size: 30,
      on_surge_failure: 'abort',
      attempt: 1,
      started_by_aid: 'archon-alice',
      started_at: '2026-05-27T15:00:00Z',
    },
  ],
  offset: 0,
  limit: 50,
  total: 1,
};

const PUSH = {
  items: [
    {
      apply_id: '01PUSH00000000000000000001',
      inventory_sids: ['h1', 'h2'],
      destiny_ref: 'web@v1.2.0',
      cleanup_stale: false,
      status: 'success',
      started_at: '2026-05-27T14:00:00Z',
      finished_at: '2026-05-27T14:01:00Z',
    },
  ],
  offset: 0,
  limit: 50,
  total: 1,
};

const ERRAND_RUNS = {
  items: [
    {
      errand_run_id: '01ERUN00000000000000000001',
      module: 'core.cmd.shell',
      status: 'failed',
      scope_size: 5,
      target_preview: 'coven=dev',
      started_at: '2026-05-27T16:00:00Z',
      finished_at: '2026-05-27T16:00:30Z',
    },
  ],
  offset: 0,
  limit: 50,
  total: 1,
};

const ERRANDS = {
  items: [
    {
      errand_id: '01ERR000000000000000000001',
      sid: 'host-x.local',
      module: 'core.cmd.shell',
      status: 'success',
      started_by_aid: 'archon-alice',
      started_at: '2026-05-27T13:00:00Z',
      finished_at: '2026-05-27T13:00:01Z',
    },
  ],
  offset: 0,
  limit: 50,
  total: 1,
};

function mockAll() {
  installFetchMock([
    { method: 'GET', url: '/v1/tides', body: TIDES },
    { method: 'GET', url: '/v1/push-runs', body: PUSH },
    { method: 'GET', url: '/v1/errand-runs', body: ERRAND_RUNS },
    { method: 'GET', url: '/v1/errands', body: ERRANDS },
  ]);
}

function dataRows(): HTMLElement[] {
  const table = screen.getByRole('table');
  const tbody = within(table).getAllByRole('rowgroup')[1];
  return within(tbody).getAllByRole('row');
}

describe('RunsFeed', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('мержит 4 run-типа и сортирует по started_at DESC', async () => {
    mockAll();
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => {
      expect(dataRows()).toHaveLength(4);
    });
    const rows = dataRows();
    // DESC: errand-run(16:00) > tide(15:00) > push(14:00) > errand(13:00).
    expect(within(rows[0]).getByText('Errand-run')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Tide')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Push')).toBeInTheDocument();
    expect(within(rows[3]).getByText('Errand')).toBeInTheDocument();
  });

  it('линкует id на корректный detail-route по типу', async () => {
    mockAll();
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    expect(screen.getByText('01TIDE0000…').closest('a')).toHaveAttribute('href', '/tides/01TIDE00000000000000000001');
    expect(screen.getByText('01PUSH0000…').closest('a')).toHaveAttribute('href', '/push-runs/01PUSH00000000000000000001');
    expect(screen.getByText('01ERUN0000…').closest('a')).toHaveAttribute('href', '/errand-runs/01ERUN00000000000000000001');
    expect(screen.getByText('01ERR00000…').closest('a')).toHaveAttribute('href', '/errands/01ERR000000000000000000001');
  });

  it('filter by type chip → остаётся только Tide', async () => {
    mockAll();
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Tide' }));
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    expect(within(dataRows()[0]).getByText('Tide')).toBeInTheDocument();
  });

  it('filter by status chip (failed) → только failed-прогон', async () => {
    mockAll();
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    const user = userEvent.setup();
    await user.click(screen.getByTestId('status-filter-failed'));
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    expect(within(dataRows()[0]).getByText('Errand-run')).toBeInTheDocument();
  });

  it('multi-select status chips (success+running) → объединение', async () => {
    mockAll();
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    const user = userEvent.setup();
    // success: push + errand; running: tide → 3 строки (failed errand-run скрыт).
    await user.click(screen.getByTestId('status-filter-success'));
    await user.click(screen.getByTestId('status-filter-running'));
    await waitFor(() => expect(dataRows()).toHaveLength(3));
  });

  it('optional-miss (push-runs 404) пропускается, остальные показываются', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/tides', body: TIDES },
      { method: 'GET', url: '/v1/push-runs', status: 404, body: { title: 'not found' } },
      { method: 'GET', url: '/v1/errand-runs', body: ERRAND_RUNS },
      { method: 'GET', url: '/v1/errands', body: ERRANDS },
    ]);
    renderWithProviders(<RunsFeed />, '/runs');
    // 3 строки вместо 4, без error-box.
    await waitFor(() => expect(dataRows()).toHaveLength(3));
    expect(screen.queryByText(/ошибка/)).not.toBeInTheDocument();
  });

  it('статус-бейдж: succeeded и success дают один tone-класс (унификация)', async () => {
    // errand-run отдаёт `succeeded` (раньше оставался серым), errand — `success`.
    // После унификации оба → один зелёный tone (одинаковый className).
    installFetchMock([
      { method: 'GET', url: '/v1/tides', body: { items: [], offset: 0, limit: 50, total: 0 } },
      { method: 'GET', url: '/v1/push-runs', body: { items: [], offset: 0, limit: 50, total: 0 } },
      {
        method: 'GET',
        url: '/v1/errand-runs',
        body: {
          items: [
            {
              errand_run_id: '01ERUN00000000000000000099',
              module: 'core.cmd.shell',
              status: 'succeeded',
              scope_size: 1,
              target_preview: 'coven=dev',
              started_at: '2026-05-27T16:00:00Z',
              finished_at: '2026-05-27T16:00:30Z',
            },
          ],
          offset: 0,
          limit: 50,
          total: 1,
        },
      },
      { method: 'GET', url: '/v1/errands', body: ERRANDS },
    ]);
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(dataRows()).toHaveLength(2));
    const table = screen.getByRole('table');
    // Внутри таблицы (не среди status-filter-чипов): по одному бейджу на статус.
    const succeededBadge = within(table).getByText('succeeded');
    const successBadge = within(table).getByText('success');
    // Оба несут одинаковый набор классов (badge + tone), а не нейтральный.
    expect(succeededBadge.className).toBe(successBadge.className);
  });

  it('date-range фильтр сужает ленту по started_at', async () => {
    mockAll();
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    const user = userEvent.setup();
    // Все 4 прогона — 27 мая 2026. Сужаем «до» 26 мая → ничего не остаётся.
    await user.clear(screen.getByTestId('date-to'));
    await user.type(screen.getByTestId('date-to'), '2026-05-26');
    await waitFor(() => {
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
    // Расширяем «до» 27 мая (конец дня включительно) → снова все 4.
    await user.clear(screen.getByTestId('date-to'));
    await user.type(screen.getByTestId('date-to'), '2026-05-27');
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    // Очистка → диапазон снят.
    await user.click(screen.getByTestId('date-clear'));
    await waitFor(() => expect(dataRows()).toHaveLength(4));
  });

  it('пустой feed → empty-state', async () => {
    const empty = { items: [], offset: 0, limit: 50, total: 0 };
    installFetchMock([
      { method: 'GET', url: '/v1/tides', body: empty },
      { method: 'GET', url: '/v1/push-runs', body: empty },
      { method: 'GET', url: '/v1/errand-runs', body: empty },
      { method: 'GET', url: '/v1/errands', body: empty },
    ]);
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => {
      expect(screen.getByText(/Ещё не было прогонов/)).toBeInTheDocument();
    });
  });
});
