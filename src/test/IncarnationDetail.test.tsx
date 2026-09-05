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
      // Before the bare incarnation route — installFetchMock matches by prefix.
      {
        method: 'GET',
        url: '/v1/incarnations/redis-prod/members',
        body: {
          items: [
            { sid: 'agent-04.local', status: 'connected', bound_at: '2026-05-20T10:00:00Z' },
            { sid: 'soul-debian-01.local', status: 'connected', bound_at: '2026-05-20T10:00:00Z' },
          ],
          offset: 0,
          limit: 50,
          total: 2,
        },
      },
      {
        method: 'GET',
        url: '/v1/incarnations/redis-prod',
        body: {
          id: 'redis-prod',
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
    // Hosts card: the roster — the membership relation. Not a count of hosts
    // labelled `redis-prod`: a bind attaches no label, so that set is a different
    // one. (Nor is it what a run acts on — that set is resolved with no caller
    // scope and then cut to hosts holding a live lease.)
    await waitFor(() => {
      expect(screen.getByText(/2 in the roster/i)).toBeInTheDocument();
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

  // The card is the only place on Overview that carries the roster count, so when
  // the roster does not arrive it is also the only place that can say so. Left on
  // its loading state it claims to still be working, forever — and this page tells
  // the operator outright, one panel over, that a 403 on this very endpoint is an
  // answer and not a wait.
  for (const c of [
    { name: 'a roster it may not read', status: 403, title: 'Forbidden', expect: /no permission/i },
    { name: 'a roster that failed to load', status: 500, title: 'Server error', expect: /unavailable/i },
  ]) {
    it(`Hosts card names ${c.name} instead of showing a loading ellipsis`, async () => {
      installFetchMock([
        {
          method: 'GET',
          url: '/v1/incarnations/redis-prod/members',
          status: c.status,
          body: { title: c.title, detail: 'nope' },
        },
        {
          method: 'GET',
          url: '/v1/incarnations/redis-prod',
          body: {
            id: 'redis-prod',
            service: 'redis',
            service_version: 'v2.0.0',
            state_schema_version: 3,
            covens: ['prod'],
            state: {},
            status: 'ready',
            created_by_aid: 'archon-alice',
            created_at: '2026-05-20T10:00:00Z',
            updated_at: '2026-05-25T12:00:00Z',
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

      const value = await screen.findByTestId('hosts-card-value');
      await waitFor(() => expect(value.textContent ?? '').toMatch(c.expect));
      // The ellipsis is the loading state. Still on screen here, it would be the
      // card telling the operator to keep waiting for something that has already
      // come back with an answer.
      expect(value.textContent).not.toBe('…');
      // And no number: a roster that did not arrive must not read as an empty one.
      expect(value.textContent ?? '').not.toMatch(/\d/);
    });
  }

  it('top-level key filter in State works', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations/svc-1',
        body: {
          id: 'svc-1',
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
          id: 'nim330-fixture',
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

  it('offers no drift check and writes nothing, on a reply that still carries both drift fields', async () => {
    // Verbatim GET /v1/incarnations/{name} from a live keeper whose row has
    // last_drift_check_at and last_drift_summary SET — the columns and the
    // endpoint are still there, they go with the backend half (NIM-446).
    //
    // Seeding both fields is the whole point. Every assertion below would also
    // pass against a reply that simply omitted them, and would then be proving
    // the fixture rather than the component: that is how the dead hosts editor
    // stayed green for five weeks (NIM-435). Here the data the removed UI read
    // is present and no UI reads it.
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
          covens: ['dev'],
          created_at: '2026-08-05T09:30:32.8937Z',
          created_by_aid: 'archon-alice',
          last_drift_check_at: '2026-08-05T10:14:01.576315Z',
          last_drift_summary: {
            hosts_clean: 1,
            hosts_drifted: 1,
            hosts_failed: 0,
            hosts_unsupported: 0,
            scanned_at: '0001-01-01T00:00:00Z',
            total_hosts: 0,
          },
          id: 'nim445-fixture',
          service: 'hello-world',
          service_version: 'main',
          state: {},
          state_schema_version: 1,
          status: 'ready',
          status_details: null,
          updated_at: '2026-08-05T09:30:32.8937Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/nim445-fixture',
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'nim445-fixture' })).toBeInTheDocument();
    });

    // The action bar is drawn in full for status=ready, so the missing button
    // below is a missing button and not a missing action bar.
    expect(screen.getByRole('button', { name: /Run Scenario/i })).toBeInTheDocument();

    // The page says nothing about drift, in any casing, anywhere. This one
    // assertion replaces a row of label-shaped ones that all shared a hole:
    // each was written from the English wording, and a control whose locale
    // key had been deleted renders the bare key instead — `checkDrift`,
    // `colLastDrift`, `tabDriftCheck` — which /Check Drift/i and friends do
    // not match. Matching the substring catches the translated string, the
    // key, and any future wording of either. It is only this blunt because
    // the fixture status is `ready`: the one legitimate `drift` on an
    // incarnation page is the status badge, and that lives on its own test.
    expect(document.body.textContent ?? '').not.toMatch(/drift/i);

    // And the timestamp behind the removed meta row is present and unread. It
    // is worded in no locale file, so it holds when the assertion above is
    // narrowed by someone who finds it too blunt.
    expect(screen.queryByText(/2026-08-05T10:14:01/)).not.toBeInTheDocument();

    // A separate property from the assertions above: no POST leaves the page.
    // This is what a resurrected mutation firing from an effect would violate,
    // and it is the half that matters most while POST .../check-drift is still
    // a live route on the keeper.
    expect(writes).toEqual([]);
  });

  it('Overview summary card clicks the Hosts tab and shows per-host runtime data', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations/r-1',
        body: {
          id: 'r-1',
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
          id: 'inc-h',
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
          id: 'redis-traits',
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
          id: 'no-traits',
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
