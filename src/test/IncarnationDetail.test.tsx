import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { IncarnationDetail } from '../pages/incarnations/IncarnationDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

describe('IncarnationDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  it('renders incarnation detail and Overview summary with navigation to State/Schema/Hosts', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations/redis-prod',
        body: {
          name: 'redis-prod',
          service: 'redis',
          service_version: 'v2.0.0',
          state_schema_version: 3,
          covens: ['prod'],
          state: {
            greeting_file: '/tmp/x',
            primary: 'host01.example.com',
            hosts: {
              'agent-04.local': { role: 'master', redis_pid: 1234 },
              'soul-debian-01.local': { role: 'replica' },
            },
          },
          status: 'ready',
          created_by_aid: 'archon-alice',
          created_at: '2026-05-20T10:00:00Z',
          updated_at: '2026-05-25T12:00:00Z',
          last_drift_check_at: '2026-05-25T11:30:00Z',
        },
      },
      // Connected souls for Overview Hosts card (real online count).
      {
        method: 'GET',
        url: '/v1/souls',
        body: {
          items: [
            { sid: 'agent-04.local', status: 'active', covens: ['redis-prod'], transport: 'agent' },
            { sid: 'soul-debian-01.local', status: 'active', covens: ['redis-prod'], transport: 'agent' },
          ],
          offset: 0,
          limit: 200,
          total: 2,
        },
      },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/redis-prod',
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'redis-prod' })).toBeInTheDocument();
    });

    // Default tab - Overview, we see Data summary.
    expect(screen.getByRole('heading', { name: 'Data summary' })).toBeInTheDocument();
    // Hosts card: 2 online (from souls API) — the only count left, a declared
    // list no longer exists.
    await waitFor(() => {
      expect(screen.getByText(/2 online/i)).toBeInTheDocument();
    });

    // Action-bar for status=ready.
    expect(screen.getByRole('button', { name: /Run Scenario/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Destroy/i })).toBeInTheDocument();

    const user = userEvent.setup();

    // Tab «State».
    await user.click(screen.getByRole('tab', { name: /^State/i }));
    expect(screen.getByRole('heading', { name: /Runtime State/i })).toBeInTheDocument();
    expect(screen.getByText(/state_schema_version:/i)).toBeInTheDocument();
    // Per-host data section shows 2 hosts.
    expect(screen.getByRole('heading', { name: /Per-host data/i })).toBeInTheDocument();
    expect(screen.getByText('agent-04.local')).toBeInTheDocument();
    expect(screen.getByText('soul-debian-01.local')).toBeInTheDocument();

    // Tab «Schema».
    await user.click(screen.getByRole('tab', { name: /Schema/i }));
    expect(screen.getByRole('heading', { name: /State Schema/i })).toBeInTheDocument();
    // service@version appears both in Schema-tab meta block and in incarnation header.
    expect(screen.getAllByText('v2.0.0').length).toBeGreaterThan(0);
  });

  it('top-level key filter in State works', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations/svc-1',
        body: {
          name: 'svc-1',
          service: 'svc',
          service_version: 'main',
          state_schema_version: 1,
          covens: [],
          state: {
            alpha: 1,
            beta: 'two',
            gamma: { x: 1 },
          },
          status: 'ready',
          created_by_aid: 'archon-x',
          created_at: '2026-05-20T10:00:00Z',
          updated_at: '2026-05-25T12:00:00Z',
        },
      },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/svc-1',
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'svc-1' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /^State/i }));

    // All three keys are visible. JsonKeyFilter renders keys as button-headers
    // with aria-expanded - a stable identifying property.
    const allKeyButtons = screen.getAllByRole('button', { expanded: false });
    const keyTexts = allKeyButtons.map((b) => b.textContent ?? '');
    expect(keyTexts.some((t) => t.includes('alpha'))).toBe(true);
    expect(keyTexts.some((t) => t.includes('beta'))).toBe(true);
    expect(keyTexts.some((t) => t.includes('gamma'))).toBe(true);

    // Filter by "alp" - leaves only alpha.
    const input = screen.getByLabelText('Filter by top-level keys');
    await user.type(input, 'alp');

    const filtered = screen.getAllByRole('button', { expanded: false }).map((b) => b.textContent ?? '');
    expect(filtered.some((t) => t.includes('alpha'))).toBe(true);
    expect(filtered.every((t) => !t.includes('beta'))).toBe(true);
    expect(filtered.every((t) => !t.includes('gamma'))).toBe(true);
  });

  it('offers no declared-hosts editor and writes nothing, on the reply shape the backend actually sends', async () => {
    // The body below is a verbatim GET /v1/incarnations/{name} reply from a live
    // keeper on migration 112: no `spec` key at all. The point of the fixture is
    // that it is NOT seeded with the field under test — a tab or a table that
    // needs `spec` has nothing to read here, exactly as in production.
    const writes: Array<{ method: string; url: string }> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method !== 'GET') writes.push({ method, url });
      if (url.includes('/v1/souls')) {
        return new Response(JSON.stringify({ items: [], offset: 0, limit: 200, total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/members')) {
        return new Response(JSON.stringify({ items: [], total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          covens: [],
          created_at: '2026-07-30T10:52:04.094288Z',
          created_by_aid: null,
          name: 'nim330-fixture',
          service: 'hello-world',
          service_version: 'main',
          state: { greeting_file: '/tmp/soul-stack-hello' },
          state_schema_version: 1,
          status: 'ready',
          status_details: null,
          updated_at: '2026-07-30T10:55:42.229544Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/nim330-fixture',
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'nim330-fixture' })).toBeInTheDocument();
    });

    // No Spec tab: the field it rendered is gone from the API.
    expect(screen.queryByRole('tab', { name: /Spec/i })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Hosts/i }));

    // The declared-hosts table and its editor are gone with the endpoint that
    // backed them (PATCH .../hosts answers 404 since NIM-330). A per-row Remove
    // button is deliberately NOT asserted on: with no `spec` there are no rows,
    // so its absence is guaranteed by the fixture rather than by the component,
    // and a green assertion there would be coverage that cannot fail.
    expect(screen.queryByText(/Declared hosts/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add host/i })).not.toBeInTheDocument();

    // Rendering the page writes nothing. This does not re-state the assertions
    // above — it holds down a separate property (no mutation fires on mount or
    // on tab switch), which is what a resurrected editor firing from an effect
    // would violate.
    expect(writes).toEqual([]);
  });

  it('Overview summary card clicks the Hosts tab and shows per-host runtime data', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations/r-1',
        body: {
          name: 'r-1',
          service: 'r',
          service_version: 'main',
          state_schema_version: 1,
          covens: [],
          state: {
            hosts: {
              'host-a': { role: 'master', pid: 1 },
            },
          },
          status: 'ready',
          created_by_aid: 'archon-x',
          created_at: '2026-05-20T10:00:00Z',
          updated_at: '2026-05-25T12:00:00Z',
        },
      },
      {
        method: 'GET',
        url: '/v1/souls',
        body: { items: [], offset: 0, limit: 200, total: 0 },
      },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/r-1',
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'r-1' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    // Click summary card "Hosts" (filter by summary button, not by tab).
    const summarySection = screen.getByRole('heading', { name: 'Data summary' }).parentElement!;
    const buttons = within(summarySection).getAllByRole('button');
    const hostsCard = buttons.find((b) => /Hosts/.test(b.textContent ?? ''))!;
    expect(hostsCard).toBeDefined();
    await user.click(hostsCard);

    // On the Hosts tab we see Per-host runtime data section with host-a.
    expect(screen.getByRole('heading', { name: /Per-host runtime data/i })).toBeInTheDocument();
    expect(screen.getByText('host-a')).toBeInTheDocument();
  });

  it('History tab: apply_id renders as a link to /incarnations/:name/runs/:apply_id (NOT /voyages/)', async () => {
    // More specific paths come FIRST (fetchMock matches the first match).
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations/inc-h/history',
        body: {
          items: [
            {
              history_id: 'hid-1',
              scenario: 'deploy',
              apply_id: '01VOYAGE000000000000001',
              changed_by_aid: 'archon-x',
              created_at: '2026-05-25T12:00:00Z',
            },
          ],
          offset: 0,
          limit: 50,
          total: 1,
        },
      },
      {
        method: 'GET',
        url: '/v1/incarnations/inc-h',
        body: {
          name: 'inc-h',
          service: 'svc',
          service_version: 'main',
          state_schema_version: 1,
          covens: [],
          state: {},
          status: 'ready',
          created_by_aid: 'archon-x',
          created_at: '2026-05-20T10:00:00Z',
          updated_at: '2026-05-25T12:00:00Z',
        },
      },
      {
        method: 'GET',
        url: '/v1/souls',
        body: { items: [], offset: 0, limit: 200, total: 0 },
      },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/inc-h',
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'inc-h' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    // Find tab by role=tab + aria-selected=false, match by text History
    const tabs = screen.getAllByRole('tab');
    const historyTab = tabs.find((t) => /History/i.test(t.textContent ?? ''))!;
    expect(historyTab).toBeDefined();
    await user.click(historyTab);

    // apply_id - apply_run (create/rerun-last/operational scenario), NOT Voyage:
    // link leads to run-view of the incarnation, not to /voyages/:id.
    await waitFor(() => {
      const link = screen.getByTestId('history-apply-link-hid-1');
      expect(link).toBeInTheDocument();
      expect((link as HTMLAnchorElement).href).toContain('/incarnations/inc-h/runs/01VOYAGE000000000000001');
      expect((link as HTMLAnchorElement).href).not.toContain('/voyages/');
    }, { timeout: 3000 });
  });

  it('Overview shows incarnation traits (scalar + list) in the meta block', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations/redis-traits',
        body: {
          name: 'redis-traits',
          service: 'redis',
          service_version: 'main',
          state_schema_version: 1,
          covens: ['prod'],
          traits: { team: 'platform', tier: ['gold', 'critical'] },
          state: {},
          status: 'ready',
          created_by_aid: 'archon-x',
          created_at: '2026-05-20T10:00:00Z',
          updated_at: '2026-05-25T12:00:00Z',
        },
      },
      { method: 'GET', url: '/v1/souls', body: { items: [], offset: 0, limit: 200, total: 0 } },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/redis-traits',
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'redis-traits' })).toBeInTheDocument();
    });

    // scalar-trait - chip team=platform.
    expect(screen.getByText('team=platform')).toBeInTheDocument();
    // list-trait - expanded via comma in one chip.
    expect(screen.getByText('tier=gold, critical')).toBeInTheDocument();
  });

  it('Overview graceful empty when incarnation.traits is absent (no crash)', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations/no-traits',
        body: {
          name: 'no-traits',
          service: 'redis',
          service_version: 'main',
          state_schema_version: 1,
          covens: [],
          state: {},
          status: 'ready',
          created_by_aid: 'archon-x',
          created_at: '2026-05-20T10:00:00Z',
          updated_at: '2026-05-25T12:00:00Z',
        },
      },
      { method: 'GET', url: '/v1/souls', body: { items: [], offset: 0, limit: 200, total: 0 } },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/no-traits',
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'no-traits' })).toBeInTheDocument();
    });

    // Traits section present, value is em-dash fallback, page does not crash.
    expect(screen.getByText('Traits')).toBeInTheDocument();
  });
});
