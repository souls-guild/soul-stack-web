import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { RunsFeed } from '../pages/runs/RunsFeed';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

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

const VOYAGES = {
  items: [
    {
      voyage_id: '01VSCY0000000000000000001',
      kind: 'scenario',
      scenario_name: 'rolling-restart',
      status: 'running',
      scope_size: 3,
      total_batches: 1,
      current_batch_index: 0,
      dry_run: false,
      attempt: 1,
      started_by_aid: 'archon-alice',
      created_at: '2026-05-27T17:00:00Z',
      started_at: '2026-05-27T17:00:00Z',
    },
    {
      voyage_id: '01VCMD0000000000000000002',
      kind: 'command',
      module: 'core.cmd.shell',
      status: 'succeeded',
      scope_size: 2,
      total_batches: 1,
      current_batch_index: 0,
      dry_run: false,
      attempt: 1,
      started_by_aid: 'archon-alice',
      created_at: '2026-05-27T17:30:00Z',
      started_at: '2026-05-27T17:30:00Z',
      finished_at: '2026-05-27T17:30:10Z',
    },
  ],
  offset: 0,
  limit: 50,
  total: 2,
};

function mockAll() {
  installFetchMock([
    { method: 'GET', url: '/v1/voyages', body: VOYAGES },
    { method: 'GET', url: '/v1/push-runs', body: PUSH },
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

  it('мержит voyage+push+errand и сортирует по started_at DESC', async () => {
    mockAll();
    renderWithProviders(<RunsFeed />, '/runs');
    // 2 voyages + 1 push + 1 errand = 4.
    await waitFor(() => {
      expect(dataRows()).toHaveLength(4);
    });
    const rows = dataRows();
    // DESC: voyage-command(17:30) > voyage-scenario(17:00) > push(14:00) > errand(13:00).
    expect(within(rows[0]).getByText('Command')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Scenario')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Push')).toBeInTheDocument();
    expect(within(rows[3]).getByText('Errand')).toBeInTheDocument();
  });

  it('линкует id на корректный detail-route по типу', async () => {
    mockAll();
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    expect(screen.getByText('01VSCY0000…').closest('a')).toHaveAttribute('href', '/voyages/01VSCY0000000000000000001');
    expect(screen.getByText('01PUSH0000…').closest('a')).toHaveAttribute('href', '/push-runs/01PUSH00000000000000000001');
    expect(screen.getByText('01ERR00000…').closest('a')).toHaveAttribute('href', '/errands/01ERR000000000000000000001');
  });

  it('filter by type chip → остаётся только Push', async () => {
    mockAll();
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Push' }));
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    expect(within(dataRows()[0]).getByText('Push')).toBeInTheDocument();
  });

  it('filter by status chip (running) → только running-прогон', async () => {
    mockAll();
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    const user = userEvent.setup();
    await user.click(screen.getByTestId('status-filter-running'));
    // voyage-scenario имеет status=running; остальные → скрыты.
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    expect(within(dataRows()[0]).getByText('Scenario')).toBeInTheDocument();
  });

  it('multi-select status chips (success+running) → объединение', async () => {
    mockAll();
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    const user = userEvent.setup();
    // running: voyage-scenario(running) = 1.
    // success: push(success) + errand(success) + voyage-command(succeeded) = 3.
    // Итого 4 (все показываются).
    await user.click(screen.getByTestId('status-filter-success'));
    await user.click(screen.getByTestId('status-filter-running'));
    await waitFor(() => expect(dataRows()).toHaveLength(4));
  });

  it('optional-miss (push-runs 404) пропускается, остальные показываются', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/voyages', body: VOYAGES },
      { method: 'GET', url: '/v1/push-runs', status: 404, body: { title: 'not found' } },
      { method: 'GET', url: '/v1/errands', body: ERRANDS },
    ]);
    renderWithProviders(<RunsFeed />, '/runs');
    // 3 строки (4 без push-miss), без error-box.
    await waitFor(() => expect(dataRows()).toHaveLength(3));
    expect(screen.queryByText(/ошибка/)).not.toBeInTheDocument();
  });

  it('статус-бейдж: succeeded и success дают один tone-класс (унификация)', async () => {
    // voyage-command отдаёт `succeeded`, errand — `success`.
    // После унификации оба → один зелёный tone (одинаковый className).
    installFetchMock([
      { method: 'GET', url: '/v1/voyages', body: VOYAGES },
      { method: 'GET', url: '/v1/push-runs', body: { items: [], offset: 0, limit: 50, total: 0 } },
      { method: 'GET', url: '/v1/errands', body: ERRANDS },
    ]);
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(dataRows()).toHaveLength(3));
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
    // Все прогоны — 27 мая 2026. Сужаем «до» 26 мая → ничего не остаётся.
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
      { method: 'GET', url: '/v1/voyages', body: empty },
      { method: 'GET', url: '/v1/push-runs', body: empty },
      { method: 'GET', url: '/v1/errands', body: empty },
    ]);
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => {
      expect(screen.getByText(/Ещё не было прогонов/)).toBeInTheDocument();
    });
  });

  it('voyages primary: voyage-scenario/voyage-command отображаются с корректными лейблами', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/voyages', body: VOYAGES },
      { method: 'GET', url: '/v1/push-runs', body: { items: [], offset: 0, limit: 50, total: 0 } },
      { method: 'GET', url: '/v1/errands', body: { items: [], offset: 0, limit: 50, total: 0 } },
    ]);
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(dataRows()).toHaveLength(2));
    // Command-voyage первый (17:30), Scenario-voyage второй (17:00).
    expect(within(dataRows()[0]).getByText('Command')).toBeInTheDocument();
    expect(within(dataRows()[1]).getByText('Scenario')).toBeInTheDocument();
    // Links → /voyages/:id (command voyage первым — новее).
    expect(screen.getByText('01VCMD0000…').closest('a')).toHaveAttribute(
      'href', '/voyages/01VCMD0000000000000000002'
    );
  });

  it('voyages 404 (optional-miss) → не показываем ошибку, push-запись показывается', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/voyages', status: 404, body: { title: 'not found' } },
      { method: 'GET', url: '/v1/push-runs', body: PUSH },
      { method: 'GET', url: '/v1/errands', body: { items: [], offset: 0, limit: 50, total: 0 } },
    ]);
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    expect(within(dataRows()[0]).getByText('Push')).toBeInTheDocument();
    // Нет error-box (graceful miss).
    expect(screen.queryByText(/ошибка/)).not.toBeInTheDocument();
  });
});
