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

// scenario apply_run (GET /v1/runs) — 4th union source + Scenario segment.
const RUNS = {
  items: [
    {
      apply_id: '01RUNAAAAAAAAAAAAAAAAAAAA1',
      incarnation: 'redis-prod',
      service: 'redis',
      scenario: 'create',
      status: 'success',
      started_by_aid: 'archon-alice',
      started_at: '2026-06-30T10:00:00Z',
      finished_at: '2026-06-30T10:05:00Z',
    },
    {
      apply_id: '01RUNBBBBBBBBBBBBBBBBBBBB2',
      incarnation: 'pg-dev',
      service: 'postgres',
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

// Service catalog (NIM-42 Service filter for Scenario) — GET /v1/services.
const SERVICES = {
  items: [
    { name: 'redis', git: 'https://example.test/redis.git', ref: 'main', created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' },
    { name: 'postgres', git: 'https://example.test/postgres.git', ref: 'main', created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' },
  ],
};

// All endpoints; /v1/runs/stats MUST come BEFORE /v1/runs (fetchMock matches by prefix).
function baseRoutes(over: Partial<{ voyages: unknown; push: unknown; errands: unknown; stats: unknown; runs: unknown; services: unknown }> = {}) {
  return [
    { method: 'GET', url: '/v1/voyages', body: over.voyages ?? VOYAGES },
    { method: 'GET', url: '/v1/push-runs', body: over.push ?? PUSH },
    { method: 'GET', url: '/v1/errands', body: over.errands ?? ERRANDS },
    { method: 'GET', url: '/v1/runs/stats', body: over.stats ?? STATS },
    { method: 'GET', url: '/v1/services', body: over.services ?? SERVICES },
    { method: 'GET', url: '/v1/runs', body: over.runs ?? RUNS },
  ];
}

// Capture URLs of all requests (to check server-side sort/offset query params).
function captureRuns(runsTotal = 2) {
  const captured = { urls: [] as string[] };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    captured.urls.push(url);
    let body: unknown = EMPTY;
    if (url.includes('/v1/runs/stats')) body = STATS;
    else if (url.startsWith('/v1/runs')) body = { ...RUNS, total: runsTotal };
    else if (url.startsWith('/v1/services')) body = SERVICES;
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

  // -- Segment: All ------------------------------------------------------------

  it('[All] merges all 4 sources (voyage+push+errand+scenario apply_run) + "first N" caption', async () => {
    installFetchMock(baseRoutes());
    renderWithProviders(<RunsFeed />, '/runs');
    // 2 voyages + 1 push + 1 errand + 2 apply_run = 6.
    await waitFor(() => expect(unionRows()).toHaveLength(6));
    // A row is present from EACH of the 4 sources (by testid, language-agnostic).
    expect(screen.getByTestId('runs-row-01VSCY0000000000000000001')).toBeInTheDocument(); // voyage
    expect(screen.getByTestId('runs-row-01PUSH00000000000000000001')).toBeInTheDocument(); // push
    expect(screen.getByTestId('runs-row-01ERR000000000000000000001')).toBeInTheDocument(); // errand
    expect(screen.getByTestId('runs-row-01RUNAAAAAAAAAAAAAAAAAAAA1')).toBeInTheDocument(); // scenario apply_run
    // "first N per type" caption is visible (we don't pass off truncation as completeness).
    expect(screen.getByTestId('runs-first-n')).toBeInTheDocument();
  });

  it('[All] scenario apply_run links to RunDetail incarnation/apply_id', async () => {
    installFetchMock(baseRoutes());
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(unionRows()).toHaveLength(6));
    const row = screen.getByTestId('runs-row-01RUNAAAAAAAAAAAAAAAAAAAA1');
    expect(within(row).getByRole('link').closest('a')).toHaveAttribute(
      'href',
      '/incarnations/redis-prod/runs/01RUNAAAAAAAAAAAAAAAAAAAA1',
    );
  });

  // -- Segment filter by type ---------------------------------------------------

  it('[segment] Push → only push rows remain; "first N" caption hidden', async () => {
    installFetchMock(baseRoutes());
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(unionRows()).toHaveLength(6));
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-push'));
    await waitFor(() => expect(unionRows()).toHaveLength(1));
    expect(screen.getByTestId('runs-row-01PUSH00000000000000000001')).toBeInTheDocument();
    // Not first-N mode -> caption is absent.
    expect(screen.queryByTestId('runs-first-n')).not.toBeInTheDocument();
    // No voyage/errand/scenario rows.
    expect(screen.queryByTestId('runs-row-01VSCY0000000000000000001')).not.toBeInTheDocument();
  });

  it('[segment] Voyage → both voyage rows (scenario+command)', async () => {
    installFetchMock(baseRoutes());
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(unionRows()).toHaveLength(6));
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-voyage'));
    await waitFor(() => expect(unionRows()).toHaveLength(2));
    expect(screen.getByTestId('runs-row-01VSCY0000000000000000001')).toBeInTheDocument();
    expect(screen.getByTestId('runs-row-01VCMD0000000000000000002')).toBeInTheDocument();
  });

  // -- Guard #1: clicking the header toggles order and aria-sort ----------------

  it('[sort union] clicking the Started header toggles aria-sort and reverses order', async () => {
    installFetchMock(baseRoutes());
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(unionRows()).toHaveLength(6));

    const startedTh = () => screen.getByTestId('runs-sort-started').closest('th')!;
    // Default — started DESC.
    expect(startedTh()).toHaveAttribute('aria-sort', 'descending');
    const descOrder = unionRows().map((r) => r.getAttribute('data-testid'));

    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-sort-started'));
    await waitFor(() => expect(startedTh()).toHaveAttribute('aria-sort', 'ascending'));
    const ascOrder = unionRows().map((r) => r.getAttribute('data-testid'));
    // All started_at differ -> ASC = reverse of DESC.
    expect(ascOrder).toEqual([...descOrder].reverse());

    // Repeat click -> DESC again.
    await user.click(screen.getByTestId('runs-sort-started'));
    await waitFor(() => expect(startedTh()).toHaveAttribute('aria-sort', 'descending'));
    // Inactive column carries aria-sort=none.
    expect(screen.getByTestId('runs-sort-status').closest('th')).toHaveAttribute('aria-sort', 'none');
  });

  // -- Guard #4: client-side sort is stable (tie-break by id) -------------------

  it('[sort union] equal started_at → order is deterministic by id (tie-break)', async () => {
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
    // Equal started_at -> id ASC deterministically: errand-aaa before errand-bbb.
    const order = unionRows().map((r) => r.getAttribute('data-testid'));
    expect(order).toEqual(['runs-row-errand-aaa', 'runs-row-errand-bbb']);
  });

  // -- Preserve: status chips + date-range + optional-miss + empty ---------------

  it('[status] chip running → only the running run', async () => {
    installFetchMock(baseRoutes({ runs: EMPTY }));
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(unionRows()).toHaveLength(4));
    const user = userEvent.setup();
    await user.click(screen.getByTestId('status-filter-running'));
    await waitFor(() => expect(unionRows()).toHaveLength(1));
    expect(screen.getByTestId('runs-row-01VSCY0000000000000000001')).toBeInTheDocument();
  });

  it('[optional-miss] push-runs 404 is skipped without an error box', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/voyages', body: VOYAGES },
      { method: 'GET', url: '/v1/push-runs', status: 404, body: { title: 'not found' } },
      { method: 'GET', url: '/v1/errands', body: ERRANDS },
      { method: 'GET', url: '/v1/runs/stats', body: STATS },
      { method: 'GET', url: '/v1/runs', body: EMPTY },
    ]);
    renderWithProviders(<RunsFeed />, '/runs');
    // 3 (voyages 2 + errand 1), scenario empty, push miss.
    await waitFor(() => expect(unionRows()).toHaveLength(3));
    expect(screen.queryByText(/error/)).not.toBeInTheDocument();
  });

  it('[empty] empty All → empty-state', async () => {
    installFetchMock(baseRoutes({ voyages: EMPTY, push: EMPTY, errands: EMPTY, runs: EMPTY }));
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(screen.getByText(/No runs yet/)).toBeInTheDocument());
  });

  it('[date-range] narrows the feed by started_at', async () => {
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

  // -- NIM-42 PART B: client-side search over loaded union rows ------------------

  it('[union-search] filters by target substring (case-insensitive), backend is NOT hit', async () => {
    installFetchMock(baseRoutes());
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(unionRows()).toHaveLength(6));
    const user = userEvent.setup();
    // target of the push row — destiny_ref "web@v1.2.0"; search in upper case.
    await user.type(screen.getByTestId('runs-union-search'), 'WEB@V1.2.0');
    await waitFor(() => expect(unionRows()).toHaveLength(1));
    expect(screen.getByTestId('runs-row-01PUSH00000000000000000001')).toBeInTheDocument();
  });

  it('[union-search] matches by id OR status; empty = no filter', async () => {
    installFetchMock(baseRoutes());
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(unionRows()).toHaveLength(6));
    const user = userEvent.setup();
    const search = screen.getByTestId('runs-union-search');
    // Substring of id (errand_id) — one result.
    await user.type(search, '01ERR0000000');
    await waitFor(() => expect(unionRows()).toHaveLength(1));
    expect(screen.getByTestId('runs-row-01ERR000000000000000000001')).toBeInTheDocument();
    // Clear — back to all 6 (filter didn't get "stuck").
    await user.clear(search);
    await waitFor(() => expect(unionRows()).toHaveLength(6));
    // Substring of status "running" — the voyage with status running.
    await user.type(search, 'running');
    await waitFor(() => expect(unionRows()).toHaveLength(1));
    expect(screen.getByTestId('runs-row-01VSCY0000000000000000001')).toBeInTheDocument();
  });

  // -- Segment: Scenario (collapsed IncarnationRunsList) ------------------------

  it('[scenario] renders apply_run from /v1/runs + stats + RunDetail/incarnation/archon links', async () => {
    installFetchMock(baseRoutes());
    renderWithProviders(<RunsFeed />, '/runs');
    await waitFor(() => expect(unionRows()).toHaveLength(6));
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-scenario'));

    await waitFor(() => expect(screen.getByTestId('runs-scenario-table')).toBeInTheDocument());
    expect(scenRows()).toHaveLength(2);
    // Per-segment controls: union status CHIPS HIDDEN, server-side status-select visible.
    // date-range IS present here (server started_after/before, NIM-42), but it's a different control.
    expect(screen.queryByTestId('status-filter-running')).not.toBeInTheDocument();
    expect(screen.getByTestId('runs-scenario-status-filter')).toBeInTheDocument();
    // stats header.
    expect(screen.getByTestId('runs-stats')).toBeInTheDocument();
    const total = screen.getByTestId('runs-stat-total');
    await waitFor(() => expect(within(total).getByText('12')).toBeInTheDocument());
    // Links.
    const row = screen.getByTestId('runs-scenario-row-01RUNAAAAAAAAAAAAAAAAAAAA1');
    expect(within(row).getByText('01RUNAAAAA…').closest('a')).toHaveAttribute(
      'href',
      '/incarnations/redis-prod/runs/01RUNAAAAAAAAAAAAAAAAAAAA1',
    );
    expect(within(row).getByRole('link', { name: 'redis-prod' })).toHaveAttribute('href', '/incarnations/redis-prod');
    expect(within(row).getByRole('link', { name: 'archon-alice' })).toHaveAttribute('href', '/archons/archon-alice');
  });

  // -- Guard #2: Scenario sends sort/sort_dir + RESETS offset on sort change ---

  it('[scenario] column sort goes into query as sort/sort_dir and RESETS offset', async () => {
    const captured = captureRuns(120); // total>limit -> Pager Next is active
    renderWithProviders(<RunsFeed />, '/runs');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-scenario'));
    await waitFor(() => expect(screen.getByTestId('runs-scenario-table')).toBeInTheDocument());

    // Go to page 2 (offset=50).
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(captured.urls.some((u) => u.startsWith('/v1/runs?') && u.includes('offset=50'))).toBe(true));

    // Click on the sortable incarnation header -> sort=incarnation & sort_dir=asc & offset RESET to 0.
    await user.click(screen.getByTestId('runs-scen-sort-incarnation'));
    await waitFor(() =>
      expect(
        captured.urls.some(
          (u) => u.startsWith('/v1/runs?') && u.includes('sort=incarnation') && u.includes('sort_dir=asc') && u.includes('offset=0'),
        ),
      ).toBe(true),
    );
    // aria-sort of the active column.
    expect(screen.getByTestId('runs-scen-sort-incarnation').closest('th')).toHaveAttribute('aria-sort', 'ascending');
  });

  // -- Guard #3: Scenario status — server-side (query + offset reset), NOT client-side --

  it('[scenario] status filter is server-side: goes to /v1/runs as ?status= and RESETS offset', async () => {
    const captured = captureRuns(120); // total>limit -> Pager Next is active
    renderWithProviders(<RunsFeed />, '/runs');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-scenario'));
    await waitFor(() => expect(screen.getByTestId('runs-scenario-table')).toBeInTheDocument());

    // Go to page 2 (offset=50).
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(captured.urls.some((u) => u.startsWith('/v1/runs?') && u.includes('offset=50'))).toBe(true));

    // Selecting status failed -> server ?status=failed AND offset RESET to 0.
    await user.selectOptions(screen.getByTestId('runs-scenario-status-filter'), 'failed');
    await waitFor(() =>
      expect(
        captured.urls.some((u) => u.startsWith('/v1/runs?') && u.includes('status=failed') && u.includes('offset=0')),
      ).toBe(true),
    );
  });

  it('[scenario] incarnation filter goes into query as ?incarnation=', async () => {
    const captured = captureRuns();
    renderWithProviders(<RunsFeed />, '/runs');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-scenario'));
    await waitFor(() => expect(screen.getByTestId('runs-scenario-table')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('redis-prod'), 'redis');
    await waitFor(() => expect(captured.urls.some((u) => u.startsWith('/v1/runs?') && u.includes('incarnation=redis'))).toBe(true));
  });

  // -- NIM-42 PART A: Service column + server sort/filter service + search q ----

  it('[scenario] renders the Service column (r.service) in header and cells', async () => {
    installFetchMock(baseRoutes());
    renderWithProviders(<RunsFeed />, '/runs');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-scenario'));
    await waitFor(() => expect(screen.getByTestId('runs-scenario-table')).toBeInTheDocument());
    // Service header button (sortable).
    expect(screen.getByTestId('runs-scen-sort-service')).toBeInTheDocument();
    // Cells: redis (row 1), postgres (row 2).
    const row1 = screen.getByTestId('runs-scenario-row-01RUNAAAAAAAAAAAAAAAAAAAA1');
    expect(within(row1).getByText('redis')).toBeInTheDocument();
    const row2 = screen.getByTestId('runs-scenario-row-01RUNBBBBBBBBBBBBBBBBBBBB2');
    expect(within(row2).getByText('postgres')).toBeInTheDocument();
  });

  it('[scenario] sorting by Service — server-side sort=service & sort_dir + reset offset', async () => {
    const captured = captureRuns(120); // total>limit -> Pager Next is active
    renderWithProviders(<RunsFeed />, '/runs');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-scenario'));
    await waitFor(() => expect(screen.getByTestId('runs-scenario-table')).toBeInTheDocument());

    // Go to page 2 (offset=50).
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(captured.urls.some((u) => u.startsWith('/v1/runs?') && u.includes('offset=50'))).toBe(true));

    await user.click(screen.getByTestId('runs-scen-sort-service'));
    await waitFor(() =>
      expect(
        captured.urls.some(
          (u) => u.startsWith('/v1/runs?') && u.includes('sort=service') && u.includes('sort_dir=asc') && u.includes('offset=0'),
        ),
      ).toBe(true),
    );
    expect(screen.getByTestId('runs-scen-sort-service').closest('th')).toHaveAttribute('aria-sort', 'ascending');
  });

  it('[scenario] Service filter — options from the keeperApi.services.list() catalog', async () => {
    installFetchMock(baseRoutes());
    renderWithProviders(<RunsFeed />, '/runs');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-scenario'));
    await waitFor(() => expect(screen.getByTestId('runs-scenario-table')).toBeInTheDocument());

    const select = screen.getByTestId('runs-scenario-service-filter');
    await waitFor(() => expect(within(select).getByRole('option', { name: 'redis' })).toBeInTheDocument());
    expect(within(select).getByRole('option', { name: 'postgres' })).toBeInTheDocument();
    // Default option "all" is present first.
    expect((select as HTMLSelectElement).options[0].value).toBe('');
  });

  it('[scenario] Service filter: catalog unavailable (404) → only default option, no crash', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/voyages', body: VOYAGES },
      { method: 'GET', url: '/v1/push-runs', body: PUSH },
      { method: 'GET', url: '/v1/errands', body: ERRANDS },
      { method: 'GET', url: '/v1/runs/stats', body: STATS },
      { method: 'GET', url: '/v1/services', status: 404, body: { title: 'not found' } },
      { method: 'GET', url: '/v1/runs', body: RUNS },
    ]);
    renderWithProviders(<RunsFeed />, '/runs');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-scenario'));
    await waitFor(() => expect(screen.getByTestId('runs-scenario-table')).toBeInTheDocument());
    const select = screen.getByTestId('runs-scenario-service-filter') as HTMLSelectElement;
    expect(select.querySelectorAll('option')).toHaveLength(1);
  });

  it('[scenario] selecting Service goes into query as ?service= and RESETS offset', async () => {
    const captured = captureRuns(120); // total>limit -> Pager Next is active
    renderWithProviders(<RunsFeed />, '/runs');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-scenario'));
    await waitFor(() => expect(screen.getByTestId('runs-scenario-table')).toBeInTheDocument());
    // Wait for the dropdown to be populated from the catalog.
    await waitFor(() =>
      expect(within(screen.getByTestId('runs-scenario-service-filter')).getByRole('option', { name: 'redis' })).toBeInTheDocument(),
    );

    // Go to page 2 (offset=50).
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(captured.urls.some((u) => u.startsWith('/v1/runs?') && u.includes('offset=50'))).toBe(true));

    await user.selectOptions(screen.getByTestId('runs-scenario-service-filter'), 'redis');
    await waitFor(() =>
      expect(
        captured.urls.some((u) => u.startsWith('/v1/runs?') && u.includes('service=redis') && u.includes('offset=0')),
      ).toBe(true),
    );
  });

  it('[scenario] free-text search q goes into query as ?q= and RESETS offset', async () => {
    const captured = captureRuns(120);
    renderWithProviders(<RunsFeed />, '/runs');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-scenario'));
    await waitFor(() => expect(screen.getByTestId('runs-scenario-table')).toBeInTheDocument());

    // Go to page 2 (offset=50).
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(captured.urls.some((u) => u.startsWith('/v1/runs?') && u.includes('offset=50'))).toBe(true));

    await user.type(screen.getByTestId('runs-scenario-search-filter'), 'redis');
    await waitFor(() =>
      expect(captured.urls.some((u) => u.startsWith('/v1/runs?') && u.includes('q=redis') && u.includes('offset=0'))).toBe(true),
    );
  });

  it('[scenario] date-range is visible and sends started_after/started_before in query + reset offset', async () => {
    const captured = captureRuns(120); // total>limit -> Pager Next is active
    renderWithProviders(<RunsFeed />, '/runs');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-scenario'));
    await waitFor(() => expect(screen.getByTestId('runs-scenario-table')).toBeInTheDocument());
    // Server-side date-range is present in the Scenario segment.
    expect(screen.getByTestId('date-from')).toBeInTheDocument();
    expect(screen.getByTestId('date-to')).toBeInTheDocument();

    // Go to page 2 (offset=50).
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(captured.urls.some((u) => u.startsWith('/v1/runs?') && u.includes('offset=50'))).toBe(true));

    // from -> started_after (start of day, ISO); offset RESET to 0.
    await user.type(screen.getByTestId('date-from'), '2026-06-01');
    await waitFor(() =>
      expect(
        captured.urls.some(
          (u) => u.startsWith('/v1/runs?') && u.includes('started_after=') && u.includes('offset=0'),
        ),
      ).toBe(true),
    );
    // to -> started_before.
    await user.type(screen.getByTestId('date-to'), '2026-06-30');
    await waitFor(() =>
      expect(captured.urls.some((u) => u.startsWith('/v1/runs?') && u.includes('started_before='))).toBe(true),
    );
  });

  it('[scenario] clearing date-range removes started_after/started_before from query', async () => {
    const captured = captureRuns();
    renderWithProviders(<RunsFeed />, '/runs');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('runs-segment-scenario'));
    await waitFor(() => expect(screen.getByTestId('runs-scenario-table')).toBeInTheDocument());

    await user.type(screen.getByTestId('date-from'), '2026-06-01');
    await waitFor(() => expect(captured.urls.some((u) => u.includes('started_after='))).toBe(true));

    // Clear -> next request WITHOUT date params.
    const before = captured.urls.length;
    await user.click(screen.getByTestId('date-clear'));
    await waitFor(() => expect(captured.urls.length).toBeGreaterThan(before));
    const last = captured.urls[captured.urls.length - 1];
    expect(last).not.toContain('started_after=');
    expect(last).not.toContain('started_before=');
  });

  // -- Guard #5: /incarnation-runs -> redirect to /runs --------------------------

  it('[redirect] /incarnation-runs redirects to /runs (backward-compat)', () => {
    // Mirrors the App.tsx route: <Route path="/incarnation-runs" element={<Navigate to="/runs" replace />} />.
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
