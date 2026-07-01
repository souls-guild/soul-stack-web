import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from './renderWithProviders';
import { OverviewPage } from '../pages/overview/OverviewPage';

// Хелпер: строит mock-fetch который диспатчит по URL+params.
function mockFetch(handlers: Record<string, unknown | { status: number; body: unknown }>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    for (const [key, entry] of Object.entries(handlers)) {
      if (urlStr.startsWith(key)) {
        const isProblem = entry !== null && typeof entry === 'object' && 'status' in entry && 'body' in entry;
        const status = isProblem ? (entry as { status: number }).status : 200;
        const body = isProblem ? (entry as { body: unknown }).body : entry;
        return new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ title: 'not mocked', url: urlStr }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
}

const VOYAGE_ITEM = {
  voyage_id: 'abcdef1234567890abc',
  kind: 'scenario',
  status: 'succeeded',
  started_at: new Date(Date.now() - 60_000).toISOString(),
  scope_size: 3,
  attempt: 1,
  current_batch_index: 0,
  total_batches: 1,
  dry_run: false,
  created_at: new Date().toISOString(),
  started_by_aid: 'archon-ops',
  target: { incarnations: ['redis-prod'] },
  scenario_name: 'update',
};

const SOUL_STATS = {
  by_status: { connected: 4, pending: 1, disconnected: 1 },
  by_transport: { agent: 5, ssh: 1 },
  by_coven: { 'redis-prod': 3, 'redis-stage': 3 },
  total: 6,
  stale_count: 9,
};

const CLUSTER_REPLY = {
  instances: [
    { kid: 'kid-a', started_at: new Date(Date.now() - 3_600_000).toISOString(), alive: true, is_reaper_leader: true },
    { kid: 'kid-b', started_at: new Date(Date.now() - 1_800_000).toISOString(), alive: false, is_reaper_leader: false },
  ],
  self_kid: 'kid-a',
  self_health: { postgres: 'ok', redis: 'ok', vault: 'unreachable: dial timeout' },
};

const COMMON_HANDLERS = {
  '/v1/incarnations': { items: [], total: 7, offset: 0, limit: 1 },
  '/v1/voyages': { items: [VOYAGE_ITEM], total: 1, offset: 0, limit: 5 },
};

describe('OverviewPage', () => {
  it('рендерит донаты souls по статусу/coven из /v1/souls/stats + 4 счётчика', async () => {
    mockFetch({
      '/v1/souls/stats': SOUL_STATS,
      '/v1/cluster': CLUSTER_REPLY,
      ...COMMON_HANDLERS,
    });

    renderWithProviders(<OverviewPage />, '/overview');

    // Transport pull/push: agent=5 (pull), ssh=1 (push).
    await waitFor(() => {
      expect(screen.getByText('5 / 1')).toBeInTheDocument();
    });
    // Covens count: 2 ключа в by_coven.
    expect(screen.getByText('2')).toBeInTheDocument();
    // Incarnations total: 7.
    expect(screen.getByText('7')).toBeInTheDocument();
    // Stale count: 9.
    expect(screen.getByText('9')).toBeInTheDocument();

    // Donut статуса — 3 slice (connected/pending/disconnected), центр = total souls (6).
    await waitFor(() => {
      expect(screen.getByTestId('donut-slice-connected')).toBeInTheDocument();
    });
    expect(screen.getByTestId('donut-slice-pending')).toBeInTheDocument();
    expect(screen.getByTestId('donut-slice-disconnected')).toBeInTheDocument();

    // Donut coven — 2 slice по имени coven.
    expect(screen.getByTestId('donut-slice-redis-prod')).toBeInTheDocument();
    expect(screen.getByTestId('donut-slice-redis-stage')).toBeInTheDocument();

    // Легенда donut показывает labels/значения.
    expect(screen.getAllByText('connected').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('redis-prod').length).toBeGreaterThanOrEqual(1);

    // Последние прогоны остаются (не тронуты этой задачей).
    await waitFor(() => {
      expect(screen.getByText('scenario')).toBeInTheDocument();
    });
    expect(screen.getByText('succeeded')).toBeInTheDocument();
  });

  it('SelfCheck рендерит инстансы кластера + self-маркер + Reaper-лидер + self_health бейджи', async () => {
    mockFetch({
      '/v1/souls/stats': SOUL_STATS,
      '/v1/cluster': CLUSTER_REPLY,
      ...COMMON_HANDLERS,
    });

    renderWithProviders(<OverviewPage />, '/overview');

    await waitFor(() => {
      expect(screen.getByText('kid-a')).toBeInTheDocument();
    });
    expect(screen.getByText('kid-b')).toBeInTheDocument();

    // self_kid=kid-a → маркер «(вы)» рядом.
    expect(screen.getByText('(вы)')).toBeInTheDocument();

    // is_reaper_leader=true только у kid-a.
    expect(screen.getByText('Reaper-лидер')).toBeInTheDocument();

    // alive/dead индикаторы.
    expect(screen.getByText('alive')).toBeInTheDocument();
    expect(screen.getByText('недоступен')).toBeInTheDocument();

    // self_health: postgres/redis=ok (✓), vault=не-ok (✗).
    expect(screen.getByText(/postgres: ✓/)).toBeInTheDocument();
    expect(screen.getByText(/redis: ✓/)).toBeInTheDocument();
    expect(screen.getByText(/vault: ✗/)).toBeInTheDocument();
  });

  it('graceful empty — souls.stats пустые оси → empty-state доната, без краша', async () => {
    mockFetch({
      '/v1/souls/stats': { by_status: {}, by_transport: {}, by_coven: {}, total: 0, stale_count: 0 },
      '/v1/cluster': { instances: [], self_kid: 'kid-solo', self_health: {} },
      ...COMMON_HANDLERS,
      '/v1/voyages': { items: null, total: 0, offset: 0, limit: 5 },
    });

    renderWithProviders(<OverviewPage />, '/overview');

    expect(await screen.findByText('Souls в кластере нет.')).toBeInTheDocument();
    expect(screen.getByText('Ни у одного Soul нет coven-метки.')).toBeInTheDocument();
    expect(screen.getByText('Инстансов не найдено.')).toBeInTheDocument();
    expect(await screen.findByText(/Прогонов пока не было/i)).toBeInTheDocument();
  });

  it('graceful degradation — 500 на /v1/souls/stats не валит страницу, показывает error-box', async () => {
    mockFetch({
      '/v1/souls/stats': { status: 500, body: { title: 'internal error', detail: 'boom' } },
      '/v1/cluster': CLUSTER_REPLY,
      ...COMMON_HANDLERS,
    });

    renderWithProviders(<OverviewPage />, '/overview');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    // Cluster-секция независима от souls.stats — рендерится нормально несмотря на fail souls.
    expect(await screen.findByText('kid-a')).toBeInTheDocument();
  });

  it('graceful degradation — 403 на /v1/cluster не валит страницу, донаты souls рендерятся', async () => {
    mockFetch({
      '/v1/souls/stats': SOUL_STATS,
      '/v1/cluster': { status: 403, body: { title: 'forbidden', detail: 'no soul.list' } },
      ...COMMON_HANDLERS,
    });

    renderWithProviders(<OverviewPage />, '/overview');

    await waitFor(() => {
      expect(screen.getByTestId('donut-slice-connected')).toBeInTheDocument();
    });
    // Cluster-секция деградирует в error-box, не крашит страницу.
    const clusterSection = screen.getByLabelText('SelfCheck: Keeper-кластер');
    expect(within(clusterSection).getByText(/forbidden|no soul.list|403/i)).toBeInTheDocument();
  });
});
