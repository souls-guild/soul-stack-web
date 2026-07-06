import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
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

const STATS = {
  all: { total: 12, applying: 1, success: 8, failed: 2, cancelled: 1 },
  last_24h: { total: 3, applying: 1, success: 2, failed: 0, cancelled: 0 },
};

// scenario apply_run (GET /v1/runs) — 4-й union-источник + Scenario-сегмент.
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

const EMPTY = { items: [], offset: 0, limit: 50, total: 0 };

// Все эндпоинты; /v1/runs/stats ОБЯЗАН идти РАНЬШЕ /v1/runs (fetchMock матчит по префиксу).
function baseRoutes(over: Partial<{ voyages: unknown; push: unknown; errands: unknown; stats: unknown; runs: unknown }> = {}) {
  return [
    { method: 'GET', url: '/v1/voyages', body: over.voyages ?? VOYAGES },
    { method: 'GET', url: '/v1/push-runs', body: over.push ?? PUSH },
    { method: 'GET', url: '/v1/errands', body: over.errands ?? ERRANDS },
    { method: 'GET', url: '/v1/runs/stats', body: over.stats ?? STATS },
    { method: 'GET', url: '/v1/runs', body: over.runs ?? RUNS },
  ];
}

// Захват URL всех запросов (для проверки серверных sort/offset query-параметров).
function captureRuns(runsTotal = 2) {
  const captured = { urls: [] as string[] };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    captured.urls.push(url);
    let body: unknown = EMPTY;
    if (url.includes('/v1/runs/stats')) body = STATS;
    else if (url.startsWith('/v1/runs')) body = { ...RUNS, total: runsTotal };
    else if (url.startsWith('/v1/voyages')) body = VOYAGES;
    else if (url.startsWith('/v1/push-runs')) body = PUSH;
    else if (url.startsWith('/v1/errands')) body = ERRANDS;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  return captured;
}

function unionRows(): HTMLElement[] {
  return screen.queryAllByTestId(/^runs-row-/);
}
function scenRows(): HTMLElement[] {
  return screen.queryAllByTestId(/^runs-scenario-row-/);
}

describe('RunsFeed (unified /runs)', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  // ── Segment: All ────────────────────────────────────────────────────────────

  it('[All] мержит все 4 источника (voyage+push+errand+scenario apply_run) + подпись «первые N»', async () => {
    installFetchMock(baseRoutes());
    renderWithProviders(<RunsFeed />, '/runs');
    // 2 voyages + 1 push + 1 errand + 2 apply_run = 6.
    await waitFor(() => expect(unionRows()).toHaveLength(6));
    // Присутствует строка из КАЖДОГО из 4 источников (по testid, устойчиво к языку).
    expect(screen.getByTestId('runs-row-01VSCY0000000000000000001')).toBeInTheDocument(); // voyage
    expect(screen.getByTestId('runs-row-01PUSH00000000000000000001')).toBeInTheDocument(); // push
    expect(screen.getByTestId('runs-row-01ERR000000000000000000001')).toBeInTheDocument(); // errand
    expect(screen.getByTestId('runs-row-01RUNAAAAAAAAAAAAAAAAAAAA1')).toBeInTheDocument(); // scenario apply_run
    // Подпись «первые N на тип» видна (не выдаём усечение за полноту).
    expect(screen.getByTestId('runs-first-n')).toBeInTheDocument();
  });

  it('[All] scenario apply_run линкуется на RunDetail incarnation/apply_id', async () => {
    installFetchMock(baseRoutes());
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(unionRows()).toHaveLength(6));
    const row = screen.getByTestId('runs-row-01RUNAAAAAAAAAAAAAAAAAAAA1');
    expect(within(row).getByRole('link').closest('a')).toHaveAttribute(
      'href',
      '/incarnations/redis-prod/runs/01RUNAAAAAAAAAAAAAAAAAAAA1',
    );
  });

  // ── Segment-фильтр по типу ───────────────────────────────────────────────────

  it('[segment] Push → остаются только push-строки; подпись «первые N» скрыта', async () => {
    installFetchMock(baseRoutes());
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(unionRows()).toHaveLength(6));
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-push'));
    await waitFor(() => expect(unionRows()).toHaveLength(1));
    expect(screen.getByTestId('runs-row-01PUSH00000000000000000001')).toBeInTheDocument();
    // Не первый-N-режим → подпись отсутствует.
    expect(screen.queryByTestId('runs-first-n')).not.toBeInTheDocument();
    // Нет voyage/errand/scenario строк.
    expect(screen.queryByTestId('runs-row-01VSCY0000000000000000001')).not.toBeInTheDocument();
  });

  it('[segment] Voyage → обе voyage-строки (scenario+command)', async () => {
    installFetchMock(baseRoutes());
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(unionRows()).toHaveLength(6));
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-voyage'));
    await waitFor(() => expect(unionRows()).toHaveLength(2));
    expect(screen.getByTestId('runs-row-01VSCY0000000000000000001')).toBeInTheDocument();
    expect(screen.getByTestId('runs-row-01VCMD0000000000000000002')).toBeInTheDocument();
  });

  // ── Guard #1: клик по заголовку меняет порядок и aria-sort ────────────────────

  it('[sort union] клик по заголовку Started тогглит aria-sort и разворачивает порядок', async () => {
    installFetchMock(baseRoutes());
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(unionRows()).toHaveLength(6));

    const startedTh = () => screen.getByTestId('runs-sort-started').closest('th')!;
    // Дефолт — started DESC.
    expect(startedTh()).toHaveAttribute('aria-sort', 'descending');
    const descOrder = unionRows().map((r) => r.getAttribute('data-testid'));

    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-sort-started'));
    await waitFor(() => expect(startedTh()).toHaveAttribute('aria-sort', 'ascending'));
    const ascOrder = unionRows().map((r) => r.getAttribute('data-testid'));
    // Все started_at различны → ASC = обратный DESC.
    expect(ascOrder).toEqual([...descOrder].reverse());

    // Повторный клик → снова DESC.
    await user.click(screen.getByTestId('runs-sort-started'));
    await waitFor(() => expect(startedTh()).toHaveAttribute('aria-sort', 'descending'));
    // Неактивная колонка несёт aria-sort=none.
    expect(screen.getByTestId('runs-sort-status').closest('th')).toHaveAttribute('aria-sort', 'none');
  });

  // ── Guard #4: клиентская сортивка стабильна (tie-break по id) ─────────────────

  it('[sort union] при равных started_at порядок детерминирован по id (tie-break)', async () => {
    const TIE_ERRANDS = {
      items: [
        { errand_id: 'errand-bbb', sid: 'h', module: 'm', status: 'success', started_at: '2026-05-27T13:00:00Z', finished_at: '2026-05-27T13:00:01Z' },
        { errand_id: 'errand-aaa', sid: 'h', module: 'm', status: 'success', started_at: '2026-05-27T13:00:00Z', finished_at: '2026-05-27T13:00:01Z' },
      ],
      offset: 0,
      limit: 50,
      total: 2,
    };
    installFetchMock(baseRoutes({ errands: TIE_ERRANDS }));
    renderWithProviders(<RunsFeed />, '/runs');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-errand'));
    await waitFor(() => expect(unionRows()).toHaveLength(2));
    // Равные started_at → id ASC детерминированно: errand-aaa раньше errand-bbb.
    const order = unionRows().map((r) => r.getAttribute('data-testid'));
    expect(order).toEqual(['runs-row-errand-aaa', 'runs-row-errand-bbb']);
  });

  // ── Preserve: status chips + date-range + optional-miss + empty ───────────────

  it('[status] chip running → только running-прогон', async () => {
    installFetchMock(baseRoutes({ runs: EMPTY }));
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(unionRows()).toHaveLength(4));
    const user = userEvent.setup();
    await user.click(screen.getByTestId('status-filter-running'));
    await waitFor(() => expect(unionRows()).toHaveLength(1));
    expect(screen.getByTestId('runs-row-01VSCY0000000000000000001')).toBeInTheDocument();
  });

  it('[optional-miss] push-runs 404 пропускается без error-box', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/voyages', body: VOYAGES },
      { method: 'GET', url: '/v1/push-runs', status: 404, body: { title: 'not found' } },
      { method: 'GET', url: '/v1/errands', body: ERRANDS },
      { method: 'GET', url: '/v1/runs/stats', body: STATS },
      { method: 'GET', url: '/v1/runs', body: EMPTY },
    ]);
    renderWithProviders(<RunsFeed />, '/runs');
    // 3 (voyages 2 + errand 1), scenario пуст, push miss.
    await waitFor(() => expect(unionRows()).toHaveLength(3));
    expect(screen.queryByText(/ошибка/)).not.toBeInTheDocument();
  });

  it('[empty] пустой All → empty-state', async () => {
    installFetchMock(baseRoutes({ voyages: EMPTY, push: EMPTY, errands: EMPTY, runs: EMPTY }));
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(screen.getByText(/Ещё не было прогонов/)).toBeInTheDocument());
  });

  it('[date-range] сужает ленту по started_at', async () => {
    installFetchMock(baseRoutes({ runs: EMPTY }));
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(unionRows()).toHaveLength(4));
    const user = userEvent.setup();
    await user.clear(screen.getByTestId('date-to'));
    await user.type(screen.getByTestId('date-to'), '2026-05-26');
    await waitFor(() => expect(screen.queryByTestId('runs-table')).not.toBeInTheDocument());
    await user.click(screen.getByTestId('date-clear'));
    await waitFor(() => expect(unionRows()).toHaveLength(4));
  });

  // ── Segment: Scenario (свёрнутый IncarnationRunsList) ─────────────────────────

  it('[scenario] рендерит apply_run из /v1/runs + stats + линки RunDetail/incarnation/archon', async () => {
    installFetchMock(baseRoutes());
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(unionRows()).toHaveLength(6));
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-scenario'));

    await waitFor(() => expect(screen.getByTestId('runs-scenario-table')).toBeInTheDocument());
    expect(scenRows()).toHaveLength(2);
    // Пер-сегментные контролы: union-чипы и date-range СКРЫТЫ, серверный status-select виден.
    expect(screen.queryByTestId('status-filter-running')).not.toBeInTheDocument();
    expect(screen.queryByTestId('date-from')).not.toBeInTheDocument();
    expect(screen.getByTestId('runs-scenario-status-filter')).toBeInTheDocument();
    // stats-шапка.
    expect(screen.getByTestId('runs-stats')).toBeInTheDocument();
    const total = screen.getByTestId('runs-stat-total');
    await waitFor(() => expect(within(total).getByText('12')).toBeInTheDocument());
    // Линки.
    const row = screen.getByTestId('runs-scenario-row-01RUNAAAAAAAAAAAAAAAAAAAA1');
    expect(within(row).getByText('01RUNAAAAA…').closest('a')).toHaveAttribute(
      'href',
      '/incarnations/redis-prod/runs/01RUNAAAAAAAAAAAAAAAAAAAA1',
    );
    expect(within(row).getByRole('link', { name: 'redis-prod' })).toHaveAttribute('href', '/incarnations/redis-prod');
    expect(within(row).getByRole('link', { name: 'archon-alice' })).toHaveAttribute('href', '/archons/archon-alice');
  });

  // ── Guard #2: Scenario шлёт sort/sort_dir + СБРАСЫВАЕТ offset при смене сортировки ─

  it('[scenario] сортировка колонки уходит в query как sort/sort_dir и СБРАСЫВАЕТ offset', async () => {
    const captured = captureRuns(120); // total>limit → Pager Next активен
    renderWithProviders(<RunsFeed />, '/runs');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-scenario'));
    await waitFor(() => expect(screen.getByTestId('runs-scenario-table')).toBeInTheDocument());

    // Уходим на 2-ю страницу (offset=50).
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await waitFor(() => expect(captured.urls.some((u) => u.startsWith('/v1/runs?') && u.includes('offset=50'))).toBe(true));

    // Клик по сортируемому заголовку incarnation → sort=incarnation & sort_dir=asc & offset СБРОШЕН в 0.
    await user.click(screen.getByTestId('runs-scen-sort-incarnation'));
    await waitFor(() =>
      expect(
        captured.urls.some(
          (u) => u.startsWith('/v1/runs?') && u.includes('sort=incarnation') && u.includes('sort_dir=asc') && u.includes('offset=0'),
        ),
      ).toBe(true),
    );
    // aria-sort активной колонки.
    expect(screen.getByTestId('runs-scen-sort-incarnation').closest('th')).toHaveAttribute('aria-sort', 'ascending');
  });

  // ── Guard #3: Scenario status — server-side (query + offset reset), НЕ клиентский ─

  it('[scenario] статус-фильтр server-side: уходит в /v1/runs как ?status= и СБРАСЫВАЕТ offset', async () => {
    const captured = captureRuns(120); // total>limit → Pager Next активен
    renderWithProviders(<RunsFeed />, '/runs');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-scenario'));
    await waitFor(() => expect(screen.getByTestId('runs-scenario-table')).toBeInTheDocument());

    // Уходим на 2-ю страницу (offset=50).
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await waitFor(() => expect(captured.urls.some((u) => u.startsWith('/v1/runs?') && u.includes('offset=50'))).toBe(true));

    // Выбор статуса failed → серверный ?status=failed И offset СБРОШЕН в 0.
    await user.selectOptions(screen.getByTestId('runs-scenario-status-filter'), 'failed');
    await waitFor(() =>
      expect(
        captured.urls.some((u) => u.startsWith('/v1/runs?') && u.includes('status=failed') && u.includes('offset=0')),
      ).toBe(true),
    );
  });

  it('[scenario] incarnation-фильтр уходит в query как ?incarnation=', async () => {
    const captured = captureRuns();
    renderWithProviders(<RunsFeed />, '/runs');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-scenario'));
    await waitFor(() => expect(screen.getByTestId('runs-scenario-table')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('redis-prod'), 'redis');
    await waitFor(() => expect(captured.urls.some((u) => u.startsWith('/v1/runs?') && u.includes('incarnation=redis'))).toBe(true));
  });

  // ── Guard #5: /incarnation-runs → редирект на /runs ───────────────────────────

  it('[redirect] /incarnation-runs редиректит на /runs (backward-compat)', () => {
    // Зеркалит маршрут App.tsx: <Route path="/incarnation-runs" element={<Navigate to="/runs" replace />} />.
    render(
      <MemoryRouter initialEntries={['/incarnation-runs']}>
        <Routes>
          <Route path="/incarnation-runs" element={<Navigate to="/runs" replace />} />
          <Route path="/runs" element={<div data-testid="runs-landing">RUNS</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('runs-landing')).toBeInTheDocument();
  });
});
