import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from './renderWithProviders';
import { OverviewPage } from '../pages/overview/OverviewPage';

// Helper: builds a mock-fetch that dispatches by URL+params.
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

const SERVICES_REPLY = {
  items: ['redis', 'postgres', 'unused'].map((id) => ({
    id,
    git: `https://git.example/${id}.git`,
    ref: 'main',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })),
};

const SERVICE_STATS = {
  by_service: [
    { service: 'postgres', incarnations: 1, hosts: 4 },
    { service: 'redis', incarnations: 5, hosts: 11 },
  ],
};

const COMMON_HANDLERS = {
  '/v1/incarnations': { items: [], total: 7, offset: 0, limit: 1 },
  '/v1/voyages': { items: [VOYAGE_ITEM], total: 1, offset: 0, limit: 5 },
  '/v1/stats/services': SERVICE_STATS,
  '/v1/services': SERVICES_REPLY,
};

describe('OverviewPage', () => {
  it('counters: transport, registered services, incarnations — no covens, no stale souls', async () => {
    mockFetch({
      '/v1/souls/stats': SOUL_STATS,
      '/v1/cluster': CLUSTER_REPLY,
      ...COMMON_HANDLERS,
    });

    renderWithProviders(<OverviewPage />, '/overview');

    const counters = screen.getByLabelText('Counters');
    // Transport pull/push: agent=5 (pull), ssh=1 (push).
    await waitFor(() => {
      expect(within(counters).getByText('5 / 1')).toBeInTheDocument();
    });
    // Registered services: all three, including the one without incarnations.
    await waitFor(() => {
      expect(within(counters).getByText('3')).toBeInTheDocument();
    });
    expect(within(counters).getByText('Services')).toBeInTheDocument();
    expect(within(counters).getByText('7')).toBeInTheDocument();
    // stale_count=9 and two covens are on the wire, and neither may surface.
    expect(within(counters).queryByText('9')).not.toBeInTheDocument();
    expect(within(counters).queryByText('2')).not.toBeInTheDocument();
    expect(screen.queryByText('Stale souls')).not.toBeInTheDocument();
    expect(screen.queryByText('Covens')).not.toBeInTheDocument();
  });

  it('souls by status stays; souls by coven is gone', async () => {
    mockFetch({
      '/v1/souls/stats': SOUL_STATS,
      '/v1/cluster': CLUSTER_REPLY,
      ...COMMON_HANDLERS,
    });

    renderWithProviders(<OverviewPage />, '/overview');

    await waitFor(() => {
      expect(screen.getByTestId('donut-slice-connected')).toBeInTheDocument();
    });
    expect(screen.getByTestId('donut-slice-pending')).toBeInTheDocument();
    expect(screen.getByTestId('donut-slice-disconnected')).toBeInTheDocument();

    expect(screen.queryByText('Souls by coven')).not.toBeInTheDocument();
    expect(screen.queryByTestId('donut-slice-redis-prod')).not.toBeInTheDocument();
    expect(screen.queryByTestId('donut-slice-redis-stage')).not.toBeInTheDocument();

    // Recent runs remain (untouched by this task).
    await waitFor(() => {
      expect(screen.getByText('scenario')).toBeInTheDocument();
    });
    expect(screen.getByText('succeeded')).toBeInTheDocument();
  });

  it('incarnations-by-service donut: a slice per service, legend ends with the total', async () => {
    mockFetch({
      '/v1/souls/stats': SOUL_STATS,
      '/v1/cluster': CLUSTER_REPLY,
      ...COMMON_HANDLERS,
    });

    renderWithProviders(<OverviewPage />, '/overview');

    const card = await screen.findByTestId('overview-incarnations-by-service');
    await waitFor(() => {
      expect(within(card).getByTestId('donut-slice-redis')).toBeInTheDocument();
    });
    expect(within(card).getByTestId('donut-slice-postgres')).toBeInTheDocument();
    // Proportional: redis holds 5 of 6 incarnations.
    const circumference = (dash: string) => dash.split(' ').map(Number).reduce((a, b) => a + b, 0);
    const redisDash = within(card).getByTestId('donut-slice-redis').getAttribute('stroke-dasharray')!;
    const [redisArc] = redisDash.split(' ').map(Number);
    expect(redisArc / circumference(redisDash)).toBeCloseTo(5 / 6, 5);

    const total = within(card).getByTestId('donut-legend-total');
    expect(total).toHaveTextContent('Total incarnations');
    expect(total).toHaveTextContent('6');
  });

  it('hosts-by-service bars: sorted by hosts, widths relative to the largest', async () => {
    mockFetch({
      '/v1/souls/stats': SOUL_STATS,
      '/v1/cluster': CLUSTER_REPLY,
      ...COMMON_HANDLERS,
    });

    renderWithProviders(<OverviewPage />, '/overview');

    const card = await screen.findByTestId('overview-hosts-by-service');
    await waitFor(() => {
      expect(within(card).getByTestId('hosts-bar-redis')).toBeInTheDocument();
    });
    const rows = within(card).getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(['hosts-bar-redis', 'hosts-bar-postgres']);
    expect(rows[0]).toHaveTextContent('11');
    expect(rows[1]).toHaveTextContent('4');
    const fill = (row: HTMLElement) => (row.querySelector('span > span') as HTMLElement).style.width;
    expect(fill(rows[0])).toBe('100%');
    expect(parseFloat(fill(rows[1]))).toBeCloseTo((4 / 11) * 100, 5);
    expect(within(rows[0]).getByRole('link', { name: 'redis' })).toHaveAttribute('href', '/services/redis');
  });

  it('exactly five services: no fold; slices by incarnations desc, ties by name; bars by hosts', async () => {
    // Input order puts each tie in the wrong order, so a stable sort without the
    // name tie-break fails: mid before beta (4 incarnations), zeta before omega (2 hosts).
    const by_service = [
      { service: 'alpha', incarnations: 1, hosts: 9 },
      { service: 'mid', incarnations: 4, hosts: 1 },
      { service: 'zeta', incarnations: 7, hosts: 2 },
      { service: 'omega', incarnations: 2, hosts: 2 },
      { service: 'beta', incarnations: 4, hosts: 0 },
    ];
    mockFetch({
      '/v1/souls/stats': SOUL_STATS,
      '/v1/cluster': CLUSTER_REPLY,
      ...COMMON_HANDLERS,
      '/v1/stats/services': { by_service },
    });

    renderWithProviders(<OverviewPage />, '/overview');

    const card = await screen.findByTestId('overview-incarnations-by-service');
    await waitFor(() => {
      expect(within(card).getByTestId('donut-slice-zeta')).toBeInTheDocument();
    });
    expect(within(card).queryByTestId('donut-slice-__other__')).not.toBeInTheDocument();
    const legend = within(card)
      .getAllByRole('listitem')
      .filter((li) => li.getAttribute('data-testid') !== 'donut-legend-total')
      .map((li) => li.textContent);
    expect(legend).toEqual(['zeta7', 'beta4', 'mid4', 'omega2', 'alpha1']);

    const bars = within(screen.getByTestId('overview-hosts-by-service'))
      .getAllByRole('listitem')
      .map((li) => li.getAttribute('data-testid'));
    expect(bars).toEqual(['hosts-bar-alpha', 'hosts-bar-omega', 'hosts-bar-zeta', 'hosts-bar-mid', 'hosts-bar-beta']);
  });

  it('more than five services fold the tail into one "other" slice', async () => {
    const by_service = Array.from({ length: 8 }, (_, i) => ({
      service: `svc-${i}`,
      incarnations: 10 - i,
      hosts: i,
    }));
    mockFetch({
      '/v1/souls/stats': SOUL_STATS,
      '/v1/cluster': CLUSTER_REPLY,
      ...COMMON_HANDLERS,
      '/v1/stats/services': { by_service },
    });

    renderWithProviders(<OverviewPage />, '/overview');

    const card = await screen.findByTestId('overview-incarnations-by-service');
    await waitFor(() => {
      expect(within(card).getByTestId('donut-slice-svc-0')).toBeInTheDocument();
    });
    for (let i = 0; i < 4; i++) {
      expect(within(card).getByTestId(`donut-slice-svc-${i}`)).toBeInTheDocument();
    }
    expect(within(card).queryByTestId('donut-slice-svc-4')).not.toBeInTheDocument();
    expect(within(card).getByTestId('donut-slice-__other__')).toBeInTheDocument();
    // svc-4..7 hold 6+5+4+3 incarnations; the total still counts every one of them.
    expect(within(card).getByText('other').closest('li')).toHaveTextContent('18');
    expect(within(card).getByTestId('donut-legend-total')).toHaveTextContent(String(by_service.reduce((s, e) => s + e.incarnations, 0)));
    // Bars are not capped: every service keeps its own row.
    expect(within(screen.getByTestId('overview-hosts-by-service')).getAllByRole('listitem')).toHaveLength(8);
  });

  it('403 on /v1/stats/services degrades both service panels, the rest renders', async () => {
    mockFetch({
      '/v1/souls/stats': SOUL_STATS,
      '/v1/cluster': CLUSTER_REPLY,
      ...COMMON_HANDLERS,
      '/v1/stats/services': { status: 403, body: { title: 'forbidden', detail: 'no incarnation.list' } },
    });

    renderWithProviders(<OverviewPage />, '/overview');

    const donutCard = await screen.findByTestId('overview-incarnations-by-service');
    await waitFor(() => {
      expect(within(donutCard).getByText(/forbidden|no incarnation.list|403/i)).toBeInTheDocument();
    });
    const barsCard = screen.getByTestId('overview-hosts-by-service');
    expect(within(barsCard).getByText(/forbidden|no incarnation.list|403/i)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The services counter comes from /v1/services and is unaffected.
    await waitFor(() => {
      expect(within(screen.getByLabelText('Counters')).getByText('3')).toBeInTheDocument();
    });
    expect(screen.getByTestId('donut-slice-connected')).toBeInTheDocument();
  });

  it('SelfCheck renders cluster instances + self marker + Reaper leader + self_health badges', async () => {
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

    // self_kid=kid-a -> "(you)" marker next to it.
    expect(screen.getByText('(you)')).toBeInTheDocument();

    // is_reaper_leader=true only for kid-a.
    expect(screen.getByText('Reaper leader')).toBeInTheDocument();

    // alive/dead indicators.
    expect(screen.getByText('alive')).toBeInTheDocument();
    expect(screen.getByText('unreachable')).toBeInTheDocument();

    // self_health: postgres/redis=ok (check), vault=not-ok (cross).
    expect(screen.getByText(/postgres: ✓/)).toBeInTheDocument();
    expect(screen.getByText(/redis: ✓/)).toBeInTheDocument();
    expect(screen.getByText(/vault: ✗/)).toBeInTheDocument();
  });

  it('graceful empty — empty axes and no incarnations → empty-states, no crash', async () => {
    mockFetch({
      '/v1/souls/stats': { by_status: {}, by_transport: {}, by_coven: {}, total: 0, stale_count: 0 },
      '/v1/cluster': { instances: [], self_kid: 'kid-solo', self_health: {} },
      ...COMMON_HANDLERS,
      '/v1/voyages': { items: null, total: 0, offset: 0, limit: 5 },
      '/v1/stats/services': { by_service: null },
      '/v1/services': { items: null },
    });

    renderWithProviders(<OverviewPage />, '/overview');

    expect(await screen.findByText('No Souls in the cluster.')).toBeInTheDocument();
    expect(await screen.findAllByText('No incarnations yet.')).toHaveLength(2);
    expect(screen.getByText('No instances found.')).toBeInTheDocument();
    expect(await screen.findByText(/No runs yet/i)).toBeInTheDocument();
  });

  it('graceful degradation — 500 on /v1/souls/stats does not break the page, shows error-box', async () => {
    mockFetch({
      '/v1/souls/stats': { status: 500, body: { title: 'internal error', detail: 'boom' } },
      '/v1/cluster': CLUSTER_REPLY,
      ...COMMON_HANDLERS,
    });

    renderWithProviders(<OverviewPage />, '/overview');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    // Cluster section is independent of souls.stats - renders fine despite souls failing.
    expect(await screen.findByText('kid-a')).toBeInTheDocument();
  });

  it('graceful degradation — 403 on /v1/cluster does not break the page, souls donuts render', async () => {
    mockFetch({
      '/v1/souls/stats': SOUL_STATS,
      '/v1/cluster': { status: 403, body: { title: 'forbidden', detail: 'no soul.list' } },
      ...COMMON_HANDLERS,
    });

    renderWithProviders(<OverviewPage />, '/overview');

    await waitFor(() => {
      expect(screen.getByTestId('donut-slice-connected')).toBeInTheDocument();
    });
    // Cluster section degrades into an error-box, does not crash the page.
    const clusterSection = screen.getByLabelText('SelfCheck: Keeper cluster');
    expect(within(clusterSection).getByText(/forbidden|no soul.list|403/i)).toBeInTheDocument();
  });
});
