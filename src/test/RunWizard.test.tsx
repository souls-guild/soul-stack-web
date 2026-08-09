import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { RunWizard } from '../pages/run/RunWizard';
import { ROSTER_SIZE_FANOUT_LIMIT } from '../pages/run/useIncarnationMembers';
import { tokenStore } from '../api/tokenStore';
import { CONSTRAINTS } from '../api/constraints.gen';

// A pre-flight verdict costs a 400ms debounce plus a round trip. The library default of
// 1000ms leaves almost no margin once the whole suite shares the machine, and a test that
// times out under load reports a bug that is not there. Kept well under vitest's own 5s
// per-test ceiling so a real failure still surfaces as its assertion, not as a timeout.
const PREFLIGHT_WAIT = 3000;

// Budget for proving a banner never appears. Charged in full on every green run, so it
// buys only what it must: the stub answers synchronously, and the anchor assertion before
// it has already proved the request went out — this covers the render that follows.
const NEVER_APPEARS_WAIT = 800;

function renderWizardWithRoutes(initialPath = '/run') {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrap({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(
    <Routes>
      <Route path="/run" element={<RunWizard />} />
      <Route path="/voyages/:id" element={<div data-testid="voyage-detail" />} />
      <Route path="/incarnations" element={<div data-testid="incarnations-list" />} />
      <Route path="/incarnations/:name" element={<div data-testid="incarnation-detail" />} />
    </Routes>,
    { wrapper: Wrap },
  );
}

interface ScenarioStubProperty {
  type?: string;
  required?: boolean;
  description?: string;
  default?: unknown;
}
interface ScenarioStubEntry {
  name: string;
  kind?: 'lifecycle' | 'operational';
  description?: string;
  input_schema?: Record<string, ScenarioStubProperty>;
}
interface SoulStub {
  sid: string;
  covens?: string[];
  status?: string;
  transport?: string;
}
interface ModuleStub {
  name: string;
  kind: 'core' | 'plugin';
  description?: string;
  states: string[];
  errand_safe: boolean;
  params?: Array<{ name: string; type?: string; required?: boolean; secret?: boolean; description?: string; multiline?: boolean; example?: string }>;
}
interface FetchStubOpts {
  serviceName?: string;
  scenarios?: ScenarioStubEntry[];
  incarnationNames?: string[];
  souls?: SoulStub[];
  // soulprint typed_facts by SID (for the soulprint filter).
  soulprints?: Record<string, unknown>;
  // Module catalog (GET /v1/modules). undefined -> default core cmd/exec.
  modules?: ModuleStub[];
  // Rosters by incarnation name (GET /v1/incarnations/{name}/members, NIM-124).
  // A name absent here answers 404, as the keeper does for an unknown incarnation.
  members?: Record<string, string[]>;
  // Rosters that answer an error instead of a list, by name -> HTTP status. 403
  // is the real one: the endpoint narrows its reply to the caller's soul scope
  // and refuses outright when the caller may not list souls at all.
  memberErrors?: Record<string, number>;
  // Rosters that never answer, so the screen can be read while they are still in
  // flight. A resolved-but-empty stub cannot show that state: it is gone by the
  // time the first assertion runs.
  deferMembers?: boolean;
}

const DEFAULT_MODULES: ModuleStub[] = [
  {
    name: 'core.cmd',
    kind: 'core',
    description: 'shell command',
    states: ['shell'],
    errand_safe: true,
    params: [{ name: 'cmd', type: 'string', required: true, multiline: true, example: 'uptime' }],
  },
  {
    name: 'core.exec',
    kind: 'core',
    description: 'binary + args',
    states: ['run'],
    errand_safe: true,
    params: [{ name: 'cmd', type: 'string', required: true, multiline: true, example: '/usr/bin/uptime' }],
  },
];

interface CapturedPost {
  url: string;
  body: unknown;
}

// Generic fetch stub: accumulates ALL POSTs in `posts` (for fan-out checks),
// `posted` is the last one. GETs return services/scenarios/incarnations/souls/soulprint.
function setupFetchStub(opts: FetchStubOpts = {}): { posted: CapturedPost | null; posts: CapturedPost[] } {
  const serviceName = opts.serviceName ?? 'redis';
  const scenarios: ScenarioStubEntry[] = opts.scenarios ?? [
    { name: 'create', kind: 'lifecycle', description: 'init', input_schema: {} },
    { name: 'restart', kind: 'operational', description: 'restart workers', input_schema: {} },
  ];
  const incarnationNames = opts.incarnationNames ?? ['redis-prod'];
  const souls: SoulStub[] = opts.souls ?? [];
  const soulprints = opts.soulprints ?? {};
  const modules = opts.modules ?? DEFAULT_MODULES;
  const members = opts.members ?? {};
  const memberErrors = opts.memberErrors ?? {};
  const ref: { posted: CapturedPost | null; posts: CapturedPost[] } = { posted: null, posts: [] };

  vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(init.body as string) : null;
    const json = (obj: unknown, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

    // PRIMARY: POST /v1/voyages/preview (S6).
    if (method === 'POST' && url.includes('/v1/voyages/preview')) {
      return json({
        kind: (body as Record<string, unknown>)?.kind ?? 'command',
        scope_size: 1,
        total_batches: 1,
        batch_mode: 'barrier',
      }, 200);
    }
    // PRIMARY: POST /v1/voyages (ADR-043 S5).
    if (method === 'POST' && (url.endsWith('/v1/voyages') || url.includes('/v1/voyages?'))) {
      const cap = { url, body };
      ref.posted = cap;
      ref.posts.push(cap);
      const kind = (body as Record<string, unknown>)?.kind ?? 'scenario';
      return json({
        voyage_id: `voy-01HZ00000000-${kind}`,
        kind,
        scope_size: 1,
        status: 'pending',
        location: `/v1/voyages/voy-01HZ00000000-${kind}`,
      }, 202);
    }
    // Legacy stubs (kept for any old test paths; no longer triggered by wizard).
    if (method === 'POST' && url.includes('/v1/errand-runs')) {
      const cap = { url, body };
      ref.posted = cap;
      ref.posts.push(cap);
      return json({ errand_run_id: 'er-01HZ00000000' }, 202);
    }
    if (method === 'POST' && /\/v1\/incarnations\/[^/]+\/scenarios\//.test(url)) {
      const cap = { url, body };
      ref.posted = cap;
      ref.posts.push(cap);
      if (body && typeof body === 'object' && 'wave' in (body as Record<string, unknown>)) {
        return json({ tide_id: 'td-01HZ00000000', incarnation: 'redis-prod', scenario: 'restart' }, 202);
      }
      return json({ apply_id: 'ap-01HZ00000000' }, 202);
    }

    // GET-stubs
    if (url.includes('/v1/services?') || url.endsWith('/v1/services')) {
      return json({
        items: [{ name: serviceName, ref: 'main', source: { type: 'git', url: 'git@x' } }],
        offset: 0,
        limit: 50,
        total: 1,
      });
    }
    if (url.includes(`/v1/services/${serviceName}/scenarios`)) {
      return json({ service: serviceName, ref: 'main', scenarios });
    }
    const membersMatch = url.match(/\/v1\/incarnations\/([^/?]+)\/members$/);
    if (membersMatch) {
      const name = decodeURIComponent(membersMatch[1]);
      if (opts.deferMembers) return new Promise<Response>(() => {});
      const status = memberErrors[name];
      if (status) return json({ title: 'Forbidden', detail: `roster of ${name}` }, status);
      const roster = members[name];
      if (!roster) return json({ title: 'Not Found', detail: `incarnation ${name} not found` }, 404);
      const items = roster.map((sid) => ({
        sid,
        // The column, not the lease: the roster reports a status that lags
        // presence, so nothing may read liveness from here (GET /v1/souls does).
        status: 'disconnected',
        bound_at: '2026-01-01T00:00:00Z',
        bound_by_aid: 'archon-x',
      }));
      return json({ items, offset: 0, limit: items.length, total: items.length });
    }
    if (url.includes('/v1/incarnations?') || url.endsWith('/v1/incarnations')) {
      return json({
        items: incarnationNames.map((name) => ({
          name,
          service: serviceName,
          service_version: 'main',
          state_schema_version: 1,
          covens: ['prod'],
          status: 'ready',
          created_by_aid: 'archon-x',
          created_at: '',
          updated_at: '',
        })),
        offset: 0,
        limit: 50,
        total: incarnationNames.length,
      });
    }
    const moduleDetailMatch = url.match(/\/v1\/modules\/([^/?]+)/);
    if (moduleDetailMatch) {
      const name = decodeURIComponent(moduleDetailMatch[1]);
      const m = modules.find((x) => x.name === name);
      if (!m) return json({}, 404);
      return json({ ...m, params: m.params ?? [] });
    }
    if (url.includes('/v1/modules')) {
      const errandSafeOnly = url.includes('errand_safe=true');
      const items = (errandSafeOnly ? modules.filter((m) => m.errand_safe) : modules).map((m) => ({
        ...m,
        params: m.params ?? [],
      }));
      return json({ items });
    }
    const soulprintMatch = url.match(/\/v1\/souls\/([^/]+)\/soulprint/);
    if (soulprintMatch) {
      const sid = decodeURIComponent(soulprintMatch[1]);
      const facts = soulprints[sid];
      if (facts === undefined) return json({}, 410);
      return json({ sid, typed_facts: facts });
    }
    if (url.includes('/v1/souls')) {
      return json({
        items: souls.map((s) => ({
          sid: s.sid,
          transport: s.transport ?? 'agent',
          status: s.status ?? 'connected',
          covens: s.covens ?? [],
          registered_at: '',
        })),
        offset: 0,
        limit: 1000,
        total: souls.length,
      });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch);
  return ref;
}

// Records every URL the wizard asks for, on top of whatever stub is already
// installed. `setupFetchStub` answers requests but keeps no log of the GETs, and
// what some assertions need is the request that must NOT have gone out.
function watchFetchUrls(): string[] {
  const inner = globalThis.fetch;
  const seen: string[] = [];
  vi.stubGlobal('fetch', ((input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    return inner(input, init);
  }) as typeof fetch);
  return seen;
}

describe('RunWizard', () => {
  beforeEach(() => {
    tokenStore.clear();
    sessionStorage.clear();
    // @ts-expect-error — EventSource not in jsdom, minimal stub.
    globalThis.EventSource = class {
      readyState = 0;
      close() {
        /* noop */
      }
      static OPEN = 1;
      static CONNECTING = 0;
      static CLOSED = 2;
    };
  });
  it('Step 1: exactly 2 workload cards (Scenario / Command), no Push', () => {
    setupFetchStub();
    renderWizardWithRoutes();
    expect(screen.getByLabelText('Scenario apply')).toBeChecked();
    expect(screen.getByLabelText('Command')).toBeInTheDocument();
    expect(screen.queryByLabelText('Push destiny')).not.toBeInTheDocument();
  });

  it('Scenario: empty regex → Next disabled, hint shown', async () => {
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    // Step 1 -> 2 (scenario select).
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    // Step 2 -> 3. Regex is empty.
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());

    // Empty regex -> matched=[], "Next" disabled, hint visible.
    expect(screen.getByLabelText('Incarnation regex')).toHaveValue('');
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
    // Hint "specify a regex or * for all" must be present on screen.
    await waitFor(() => expect(screen.getByText(/enter a regex or \* for all/)).toBeInTheDocument());
  });

  // NIM-73 A2: leading paragraph of scenario description -> prominent info callout ABOVE fields
  // (operator sees the precondition before running); rest of description is dim outside the callout.
  it('Scenario: leading description paragraph renders as a prominent callout above fields', async () => {
    setupFetchStub({
      scenarios: [
        {
          name: 'add_user',
          kind: 'operational',
          description:
            '★ Before running, seed the added user password in Vault at secret/redis/<incarnation>/users/<name>#password\n\nAdd or override a single ACL user on a running Redis without a restart.',
          input_schema: { username: { type: 'string' } },
        },
      ],
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    // Step 1 -> 2 -> select service and scenario.
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /add_user/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'add_user');

    // Step 2 -> 3: scenario input fields + note are rendered.
    await user.click(screen.getByRole('button', { name: /Next/ }));

    const note = await screen.findByTestId('scenario-note');
    expect(note).toHaveTextContent(/Before running, seed the added user password in Vault/);
    // Callout contains ONLY the leading paragraph; rest of the description renders separately.
    expect(note).not.toHaveTextContent(/Add or override a single ACL user/);
    expect(screen.getByText(/Add or override a single ACL user on a running Redis without a restart/)).toBeInTheDocument();
  });

  it('Scenario: regex * → all incarnations → submit', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-prod', 'redis-staging'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    // Step 1 -> 2 (scenario select).
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    // Step 2 -> 3. Type * -> ALL incarnations match.
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() => {
      const list = screen.getByLabelText('Matched incarnations').textContent ?? '';
      expect(list).toContain('redis-prod');
      expect(list).toContain('redis-staging');
    });
    expect(screen.getByRole('button', { name: /Next/ })).not.toBeDisabled();

    // Step 3 -> 4 -> submit -> POST /v1/voyages with incarnations=[redis-prod, redis-staging].
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    // A single POST to /v1/voyages (no fan-out).
    const voyagePosts = stub.posts.filter((p) => p.url.includes('/v1/voyages'));
    expect(voyagePosts).toHaveLength(1);
    const vBody = voyagePosts[0].body as { kind: string; scenario_name: string; target: { incarnations: string[] } };
    expect(vBody.kind).toBe('scenario');
    expect(vBody.scenario_name).toBe('restart');
    expect(vBody.target.incarnations.sort()).toEqual(['redis-prod', 'redis-staging']);
  });

  it('Scenario regex filter: matched subset → fan-out over matched', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-a', 'redis-b', 'pg-1'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    // regex ^redis- -> only redis-a / redis-b (pg-1 doesn't match).
    await user.type(screen.getByLabelText('Incarnation regex'), '^redis-');
    await waitFor(() => {
      const list = screen.getByLabelText('Matched incarnations').textContent ?? '';
      expect(list).toContain('redis-a');
      expect(list).toContain('redis-b');
      expect(list).not.toContain('pg-1');
    });

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    // A single POST /v1/voyages with only the matched incarnations (redis-a, redis-b).
    const voyagePosts = stub.posts.filter((p) => p.url.includes('/v1/voyages'));
    expect(voyagePosts).toHaveLength(1);
    const vBody = voyagePosts[0].body as { target: { incarnations: string[] } };
    expect(vBody.target.incarnations.sort()).toEqual(['redis-a', 'redis-b']);
    expect(vBody.target.incarnations).not.toContain('pg-1');
  });

  it('Scenario: host counts come from the roster, and are not read before the step that shows them', async () => {
    setupFetchStub({
      incarnationNames: ['redis-prod'],
      members: { 'redis-prod': ['a.local', 'b.local'] },
    });
    const seen = watchFetchUrls();
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    // The service is chosen, so the incarnation list is already in — which is the
    // whole point of asserting here. One roster request per incarnation of the
    // service is a fan-out the operator may never look at: it is spent on step 2,
    // where no count is on screen and Back to step 1 is still one click away.
    await waitFor(() => expect(seen.some((u) => u.includes('/v1/incarnations?'))).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: /Next/ })).not.toBeDisabled());
    expect(seen.some((u) => u.includes('/members'))).toBe(false);

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.type(screen.getByLabelText('Incarnation regex'), '*');

    // 2 — the roster. The souls stub holds no host at all, so this number can only
    // have come from `/members`; a count read off the label column would be 0.
    const list = screen.getByLabelText('Matched incarnations');
    await waitFor(() => expect(within(list).getByText(/2 in the roster/)).toBeInTheDocument());
    // And the badge the operator actually reads before pressing Run.
    expect(screen.getByText('2 in the rosters')).toBeInTheDocument();
    // Which is a roster size, not what the run will reach: the server resolves
    // the run's hosts with no caller scope and then drops the ones without a live
    // lease. The badge sits on the last screen before Run, so it has to say so.
    expect(screen.getByTestId('total-hosts-hint').textContent ?? '').toMatch(/not the run's reach/i);
    expect(seen.some((u) => u.includes('/v1/incarnations/redis-prod/members'))).toBe(true);
    expect(seen.some((u) => u.startsWith('/v1/souls') && u.includes('coven='))).toBe(false);
  });

  it('Scenario: a roster this operator may not read SAYS so, and says the run still targets it', async () => {
    setupFetchStub({
      incarnationNames: ['redis-prod', 'redis-staging'],
      members: { 'redis-staging': ['b.local'] },
      // The narrow-scope answer, on one of the two names only: the other still
      // resolves, so a blanket "nothing could be read" would not fit either.
      memberErrors: { 'redis-prod': 403 },
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.type(screen.getByLabelText('Incarnation regex'), '*');

    const list = screen.getByLabelText('Matched incarnations');
    await waitFor(() => expect(within(list).getByText(/1 in the roster/)).toBeInTheDocument());

    // The dash on the forbidden row is the whole point: without the notice it is
    // the same dash the over-cap case gets, and the operator cannot tell "not
    // readable by you" from "not read" from "no hosts".
    const notice = await screen.findByTestId('host-count-forbidden');
    expect(notice.textContent).toContain('redis-prod');
    expect(notice.textContent).not.toContain('redis-staging');
    // And the part that decides what the operator does next: the run does NOT
    // drop that incarnation. Saying only "unknown" would read as "excluded".
    expect(notice.textContent ?? '').toMatch(/still targets/i);
    expect(screen.getAllByText(/hosts: —/).length).toBe(1);
  });

  it('Scenario: rosters still in flight read as PENDING, not as unknown', async () => {
    // Never-answering rosters: the row has no count, exactly as it has none when
    // the roster came back forbidden. Two causes, and only one of them means the
    // count is never coming.
    setupFetchStub({ incarnationNames: ['redis-prod'], deferMembers: true });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.type(screen.getByLabelText('Incarnation regex'), '*');

    const list = screen.getByLabelText('Matched incarnations');
    await waitFor(() => expect(within(list).getByText('redis-prod')).toBeInTheDocument());
    await waitFor(() => expect(within(list).getByText(/hosts: …/)).toBeInTheDocument());
    // The em dash is what a settled "no count" looks like. On screen here it
    // would be the wizard reporting a verdict on a request still in the air.
    expect(within(list).queryByText(/hosts: —/)).toBeNull();
    // And no notice: nothing has failed, so there is nothing to explain yet.
    expect(screen.queryByTestId('host-count-forbidden')).toBeNull();
    expect(screen.queryByTestId('host-count-failed')).toBeNull();
    expect(screen.queryByTestId('host-count-unknown')).toBeNull();
  });

  it('Scenario: past the roster fan-out cap the screen SAYS the counts are unread', async () => {
    const names = Array.from({ length: ROSTER_SIZE_FANOUT_LIMIT + 1 }, (_, i) => `redis-${i}`);
    setupFetchStub({ incarnationNames: names });
    const seen = watchFetchUrls();
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-0'),
    );

    // Every row reads "unknown" and the cap is the only reason — so the reason has
    // to be on screen. Silence here is a screen that looks broken to an operator
    // who cannot tell "not read" from "no hosts".
    const notice = await screen.findByTestId('host-count-over-cap');
    expect(notice.textContent).toContain(String(ROSTER_SIZE_FANOUT_LIMIT));
    expect(screen.getAllByText(/hosts: —/).length).toBe(names.length);
    expect(seen.some((u) => u.includes('/members'))).toBe(false);
  });

  it('Scenario invalid regex → 0 matches, submit disabled', async () => {
    setupFetchStub({ incarnationNames: ['redis-a'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    // Unclosed group — invalid regex.
    await user.type(screen.getByLabelText('Incarnation regex'), '(redis');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toMatch(/no matches/),
    );
    // 0 matches -> "Next" disabled (no incarnations for fan-out).
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
  });

  it('Scenario per-field input reaches submit body.input', async () => {
    const stub = setupFetchStub({
      serviceName: 'hello-world',
      incarnationNames: ['hello-prod'],
      scenarios: [
        {
          name: 'set_greeting',
          kind: 'operational' as const,
          description: 'set greeting',
          input_schema: { greeting: { type: 'string', required: true, description: 'greet text' } },
        },
      ],
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'hello-world');
    await waitFor(() => expect(screen.getByRole('option', { name: /set_greeting/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'set_greeting');

    // Step 2 -> 3 (incarnations + input). * -> matches hello-prod.
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('hello-prod'),
    );

    const greetingField = await screen.findByTestId('field-text-greeting') as HTMLInputElement;
    await user.type(greetingField, 'hello world');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect(stub.posted?.url).toContain('/v1/voyages');
    const vBody = stub.posted?.body as { kind: string; scenario_name: string; input: Record<string, unknown>; target: { incarnations: string[] } };
    expect(vBody.kind).toBe('scenario');
    expect(vBody.scenario_name).toBe('set_greeting');
    expect(vBody.input).toEqual({ greeting: 'hello world' });
    expect(vBody.target.incarnations).toContain('hello-prod');
  });

  it('Scenario without input_schema → DynamicInputBuilder, fields in POST.input', async () => {
    const stub = setupFetchStub({
      serviceName: 'redis',
      incarnationNames: ['redis-prod'],
      scenarios: [{ name: 'restart', description: 'restart workers' }],
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await waitFor(() => expect(screen.getByLabelText('Scenario input fields')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Add first field/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /field key/i }), { target: { value: 'shard' } });
    fireEvent.change(screen.getByRole('textbox', { name: /field value/i }), { target: { value: 'primary' } });

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect((stub.posted?.body as { input: Record<string, unknown> }).input).toEqual({ shard: 'primary' });
  });

  it('Scenario mixed schema (simple + array): typed fields, not raw-JSON fallback', async () => {
    // Regression: previously a single composite type (array/object) dropped the WHOLE form into
    // DynamicInputBuilder, hiding simple typed fields. Now — per-field.
    const stub = setupFetchStub({
      serviceName: 'redis',
      incarnationNames: ['redis-prod'],
      scenarios: [
        {
          name: 'add_replicas',
          description: 'scale',
          input_schema: {
            redis_maxmemory: { type: 'string', description: 'mem', default: '256mb' },
            replicas: { type: 'array', required: true, description: 'new replica SIDs' },
          },
        },
      ],
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /add_replicas/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'add_replicas');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    // Simple field — typed input (NOT a raw-JSON-textarea form).
    await waitFor(() => expect(screen.getByText(/^redis_maxmemory$/)).toBeInTheDocument());
    // Composite field — per-field JSON-textarea.
    const composite = screen.getByTestId('field-composite-replicas') as HTMLTextAreaElement;
    expect(composite).toBeInTheDocument();
    // Did NOT degrade into the generic DynamicInputBuilder.
    expect(screen.queryByLabelText('Scenario input fields')).not.toBeInTheDocument();

    // Invalid JSON in the composite field -> submit blocked + inline error.
    fireEvent.change(composite, { target: { value: '[broken' } });
    await waitFor(() => expect(screen.getByTestId('field-json-error-replicas')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();

    // Valid JSON array -> unblocked; value reaches submit.input.
    fireEvent.change(composite, { target: { value: '["r1.example.com","r2.example.com"]' } });
    await waitFor(() => expect(screen.queryByTestId('field-json-error-replicas')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect((stub.posted?.body as { input: Record<string, unknown> }).input).toEqual({
      redis_maxmemory: '256mb',
      replicas: ['r1.example.com', 'r2.example.com'],
    });
  });

  it('Stepper: jumping forward to an invalid step is blocked (does not mark done)', async () => {
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    // On Step 1, steps 2/3/4 are not yet reachable (scenario not selected) -> their buttons are disabled.
    const stepButtons = screen.getByLabelText('Wizard steps').querySelectorAll('button');
    // [0]=Step1 (current), [1]=Step2, [2]=Step3, [3]=Step4.
    expect(stepButtons[3]).toBeDisabled();
    expect(stepButtons[2]).toBeDisabled();

    // Clicking "4" doesn't move to Step 4 (we stay on Step 1).
    await user.click(stepButtons[3]);
    expect(screen.getByLabelText('Scenario apply')).toBeInTheDocument();
    // No step is marked done (stepDone) — nothing is highlighted white.
    const doneCount = Array.from(screen.getByLabelText('Wizard steps').querySelectorAll('button')).filter(
      (b) => /stepDone/.test(b.className),
    ).length;
    expect(doneCount).toBe(0);
  });

  it('Command: host selector resolves coven criterion → sids in POST /v1/errand-runs', async () => {
    const stub = setupFetchStub({
      souls: [
        { sid: 'db-1.example.com', covens: ['prod', 'db'] },
        { sid: 'db-2.example.com', covens: ['prod', 'db'] },
        { sid: 'web-1.example.com', covens: ['prod', 'web'] },
      ],
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    // Step 2 — host selector. Filter by coven=db.
    const covenChip = await screen.findByLabelText('Coven labels');
    const covenInput = covenChip.querySelector('input') as HTMLInputElement;
    await user.type(covenInput, 'db ');

    // Preview: 2 hosts match.
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/2 hosts match/));

    // Step 2 -> 3 (module/params). Default module core.cmd.shell -> params form with textarea cmd.
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');

    // Step 3 -> 4 -> submit.
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Concurrency')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect(stub.posted?.url).toContain('/v1/voyages');
    const body = stub.posted?.body as { kind: string; module: string; input: { cmd: string }; target: { sids: string[] }; concurrency: number };
    expect(body.kind).toBe('command');
    expect(body.module).toBe('core.cmd.shell');
    expect(body.input.cmd).toBe('uptime');
    expect(body.target.sids.sort()).toEqual(['db-1.example.com', 'db-2.example.com']);
    expect(body.concurrency).toBe(50);
  });

  // NIM-449. The criterion is a membership question (`incarnation_membership`,
  // NIM-124); it used to be answered from the `souls.coven` column, which the
  // incarnation's name also happens to appear in. The fixture makes the two
  // disagree in both directions, so a resolver that went back to the column
  // targets exactly the wrong host — same count, different SID.
  it('[GUARD] Command: the Incarnations criterion targets the roster, not the coven label', async () => {
    const stub = setupFetchStub({
      souls: [
        // A member that never got the label.
        { sid: 'db-1.example.com', covens: ['prod'] },
        // Labelled with the incarnation's name, but not on its roster.
        { sid: 'web-1.example.com', covens: ['redis-prod'] },
      ],
      members: { 'redis-prod': ['db-1.example.com'] },
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    const incChip = await screen.findByLabelText('Incarnations criterion');
    await user.type(incChip.querySelector('input') as HTMLInputElement, 'redis-prod ');

    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    const preview = screen.getByLabelText('Host preview').textContent ?? '';
    expect(preview).toContain('db-1.example.com');
    expect(preview).not.toContain('web-1.example.com');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Concurrency')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as { target: { sids: string[] } };
    expect(body.target.sids).toEqual(['db-1.example.com']);
  });

  // The criterion is an OR over the names, so one that cannot be resolved must
  // not cancel the ones that can. With a single name the distinction is invisible.
  it('[GUARD] Command: an unresolvable name does not erase the hosts of the names that resolved', async () => {
    setupFetchStub({
      souls: [{ sid: 'db-1.example.com', covens: [] }],
      members: { 'redis-prod': ['db-1.example.com'] },
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    const input = (await screen.findByLabelText('Incarnations criterion')).querySelector(
      'input',
    ) as HTMLInputElement;
    await user.type(input, 'redis-typo ');
    await waitFor(() => expect(screen.getByTestId('host-incarnation-unknown')).toBeInTheDocument());
    await user.type(input, 'redis-prod ');

    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    expect(screen.getByLabelText('Host preview').textContent).toContain('db-1.example.com');
    // The bad name stays reported — hosts arriving is not a reason to hide it.
    expect(screen.getByTestId('host-incarnation-unknown')).toHaveTextContent('redis-typo');
  });

  it('Command: an incarnation with no roster is called out, and blocks the step', async () => {
    setupFetchStub({
      // The label is there; the roster is not. Silence here would read as
      // "that incarnation is empty" instead of "there is no such incarnation".
      souls: [{ sid: 'web-1.example.com', covens: ['redis-typo'] }],
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    const incChip = await screen.findByLabelText('Incarnations criterion');
    await user.type(incChip.querySelector('input') as HTMLInputElement, 'redis-typo ');

    await waitFor(() => expect(screen.getByTestId('host-incarnation-unknown')).toHaveTextContent('redis-typo'));
    expect(screen.getByLabelText('Host preview').textContent).toMatch(/0 hosts match/);
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
  });

  it('Command: batch (string) filled → sent in Voyage POST as a raw string', async () => {
    const stub = setupFetchStub({
      souls: [
        { sid: 'db-1.example.com', covens: ['prod'] },
      ],
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'prod ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());
    // Enter the string "3" — send a raw string, don't parse client-side.
    await user.type(screen.getByLabelText('Batch'), '3');

    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    expect(body.kind).toBe('command');
    // batch — string, NOT a number; batch_size/batch_percent are absent.
    expect(body.batch).toBe('3');
    expect('batch_size' in body).toBe(false);
    expect('batch_percent' in body).toBe(false);
  });

  it('Command: empty batch → batch not in Voyage POST body', async () => {
    const stub = setupFetchStub({
      souls: [{ sid: 'db-1.example.com', covens: ['prod'] }],
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'prod ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    // don't fill in batch.
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    expect('batch' in body).toBe(false);
    expect('batch_size' in body).toBe(false);
  });

  it('Command: schedule_at → sent in Voyage POST', async () => {
    const stub = setupFetchStub({
      souls: [{ sid: 'db-1.example.com', covens: ['prod'] }],
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'prod ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Schedule at')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Schedule at'), { target: { value: '2099-06-01T10:00' } });

    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    expect(body.schedule_at).toBe(new Date('2099-06-01T10:00').toISOString());
  });

  it('Command: dry_run checkbox unavailable (command workload), body without dry_run=true', async () => {
    const stub = setupFetchStub({
      souls: [{ sid: 'db-1.example.com', covens: ['prod'] }],
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'prod ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    // dry_run checkbox should not be on step 4 for command-workload.
    expect(screen.queryByLabelText('dry_run')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect((stub.posted?.body as Record<string, unknown>).dry_run).toBe(false);
  });

  it('Command: SID-regex criterion resolves a subset of hosts', async () => {
    const stub = setupFetchStub({
      souls: [
        { sid: 'db-1.example.com', covens: [] },
        { sid: 'db-2.example.com', covens: [] },
        { sid: 'web-1.example.com', covens: [] },
      ],
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    // Full-match (anchored): a prefix needs `.*`, otherwise `db-` would match
    // only the exact string "db-".
    await user.type(screen.getByLabelText('SID regex'), 'db-.*');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/2 hosts match/));

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as { target: { sids: string[] } };
    expect(body.target.sids.sort()).toEqual(['db-1.example.com', 'db-2.example.com']);
  });

  it('Command module-search: pick a plugin module from the catalog → params form → POST', async () => {
    const stub = setupFetchStub({
      souls: [{ sid: 'host-a.example.com', covens: ['prod'] }],
      modules: [
        ...DEFAULT_MODULES,
        {
          name: 'official.http',
          kind: 'plugin',
          description: 'HTTP probe',
          states: ['probe'],
          errand_safe: true,
          params: [
            { name: 'url', type: 'string', required: true, description: 'target URL' },
            { name: 'timeout', type: 'int', required: false },
          ],
        },
      ],
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    // Host selector: coven=prod -> 1 host.
    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'prod ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    // Params step: open the module picker, search and select a plugin module from the catalog.
    await waitFor(() => expect(screen.getByTestId('module-picker-control')).toBeInTheDocument());
    await user.click(screen.getByTestId('module-picker-control'));
    await user.type(screen.getByTestId('module-picker-search'), 'http');
    await user.click(await screen.findByTestId('module-option-official.http'));

    // Params form from params[]: typed field url (required) + timeout.
    await waitFor(() => expect(screen.getByTestId('module-params-form')).toBeInTheDocument());
    const urlField = await screen.findByTestId('field-text-url') as HTMLInputElement;
    await user.type(urlField, 'https://example.com');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as { kind: string; module: string; input: Record<string, unknown>; target: { sids: string[] } };
    expect(body.kind).toBe('command');
    // Full module address — name.state.
    expect(body.module).toBe('official.http.probe');
    expect(body.input).toEqual({ url: 'https://example.com' });
    expect(body.target.sids).toEqual(['host-a.example.com']);
  });

  it('Command module-search: catalog unavailable (404) → free-text name + DynamicInputBuilder', async () => {
    const stub = setupFetchStub({
      souls: [{ sid: 'host-a.example.com', covens: ['prod'] }],
      modules: [], // list will return {items:[]}; overridden with 404 below
    });
    // Override /v1/modules with 404 (graceful-fallback path).
    const baseFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/v1/modules')) {
        return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      return baseFetch(input, init);
    }) as typeof fetch);

    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'prod ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    // Free-text fallback: enter the module name manually + dynamic input.
    const freeText = await screen.findByTestId('module-freetext');
    await user.clear(freeText);
    await user.type(freeText, 'core.http.probe');
    await waitFor(() => expect(screen.getByTestId('module-dynamic-input')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Add first field/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /field key/i }), { target: { value: 'url' } });
    fireEvent.change(screen.getByRole('textbox', { name: /field value/i }), { target: { value: 'https://example.com' } });

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as { kind: string; module: string; input: Record<string, unknown> };
    expect(body.kind).toBe('command');
    // free-text without a state segment -> name as-is (core.http.probe).
    expect(body.module).toBe('core.http.probe');
    expect(body.input).toEqual({ url: 'https://example.com' });
  });

  it('Command state survives workload switching Command↔Scenario↔Command', async () => {
    setupFetchStub({ souls: [{ sid: 'db-1.example.com', covens: ['db'] }] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    // Command -> Step2 host -> Step3 params, fill in the cmd field.
    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'db ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');

    // Back to Step1, switch to Scenario and back to Command.
    await user.click(screen.getByRole('button', { name: /Back/ }));
    await user.click(screen.getByRole('button', { name: /Back/ }));
    await user.click(screen.getByLabelText('Scenario apply'));
    await user.click(screen.getByLabelText('Command'));

    // Go forward to Step3 — paramFields.cmd value persisted via the draft.
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    expect((screen.getByTestId('field-multiline-cmd') as HTMLTextAreaElement).value).toBe('uptime');
  });

  it('Scenario required field blocks Next/submit + inline error', async () => {
    setupFetchStub({
      serviceName: 'hello-world',
      incarnationNames: ['hello-prod'],
      scenarios: [
        {
          name: 'set_greeting',
          kind: 'operational' as const,
          description: 'set greeting',
          input_schema: { greeting: { type: 'string', required: true, description: 'greet text' } },
        },
      ],
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'hello-world');
    await waitFor(() => expect(screen.getByRole('option', { name: /set_greeting/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'set_greeting');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('hello-prod'),
    );

    // required greeting is empty -> inline error + Next button disabled.
    await waitFor(() => expect(screen.getByTestId('field-required-greeting')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();

    // Fill in -> error clears, can proceed.
    const greetingField = await screen.findByTestId('field-text-greeting') as HTMLInputElement;
    await user.type(greetingField, 'hi');
    await waitFor(() => expect(screen.queryByTestId('field-required-greeting')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Next/ })).not.toBeDisabled();
  });

  it('Scenario: batch (string) filled → sent in Voyage POST as a raw string', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Next/ }));
    // Batch field is present, enter a value.
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Batch'), '5');

    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect(stub.posted?.url).toContain('/v1/voyages');
    const body = stub.posted?.body as {
      kind: string;
      scenario_name: string;
      batch?: string;
      on_failure?: string;
      concurrency?: number;
      target: { incarnations: string[] };
    };
    expect(body.kind).toBe('scenario');
    expect(body.scenario_name).toBe('restart');
    // batch — string, NOT a number.
    expect(body.batch).toBe('5');
    expect('batch_size' in body).toBe(false);
    expect(body.on_failure).toBe('abort');
    expect(body.concurrency).toBe(50);
    expect(body.target.incarnations).toContain('redis-prod');
  });

  it('Scenario: empty batch → batch not in Voyage POST body', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    // Batch is empty by default — don't fill in.
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    // Empty batch -> don't send the field.
    expect('batch' in body).toBe(false);
    expect('batch_size' in body).toBe(false);
    expect((body.target as { incarnations: string[] }).incarnations).toContain('redis-prod');
  });

  it('Scenario + dry-run: Voyage POST carries dry_run=true in body', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('dry_run')).toBeInTheDocument());
    await user.click(screen.getByLabelText('dry_run'));
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect(stub.posted?.url).toContain('/v1/voyages');
    expect((stub.posted?.body as Record<string, unknown>).dry_run).toBe(true);
  });

  it('Scenario without dry-run: Voyage POST carries dry_run=false', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect((stub.posted?.body as Record<string, unknown>).dry_run).toBe(false);
  });

  it('Scenario + schedule_at: sent in Voyage POST', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Schedule at')).toBeInTheDocument());
    // datetime-local input — change via fireEvent.
    fireEvent.change(screen.getByLabelText('Schedule at'), { target: { value: '2099-12-31T23:59' } });
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    expect(body.schedule_at).toBe(new Date('2099-12-31T23:59').toISOString());
  });

  it('Scenario: empty schedule_at → schedule_at not in Voyage POST body', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Next/ }));
    // schedule_at is empty — don't fill in.
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    expect('schedule_at' in body).toBe(false);
  });

  it('Scenario: schedule_at in the past → submit disabled, error shown', async () => {
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Schedule at')).toBeInTheDocument());
    // Time in the past — should block submit and show an error.
    fireEvent.change(screen.getByLabelText('Schedule at'), { target: { value: '2000-01-01T00:00' } });

    const submitBtn = screen.getByRole('button', { name: /Run/ });
    expect(submitBtn).toBeDisabled();
    expect(screen.getByText(/Schedule time must be in the future/)).toBeInTheDocument();
  });

  it('Scenario: schedule_at in the future → submit enabled, schedule_at in body', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Schedule at')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Schedule at'), { target: { value: '2099-06-15T12:00' } });

    const submitBtn = screen.getByRole('button', { name: /Run/ });
    expect(submitBtn).not.toBeDisabled();
    expect(screen.queryByText(/Schedule time must be in the future/)).not.toBeInTheDocument();

    await user.click(submitBtn);
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());
    expect((stub.posted?.body as Record<string, unknown>).schedule_at).toBe(new Date('2099-06-15T12:00').toISOString());
  });

  it('Stale draft of an old form (no v / no incarnations) → wizard loads on defaults without crashing', async () => {
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    // Draft of the previous form version: no `v` field, scenarioState without
    // `incarnations` (array added recently), options without Tide fields.
    sessionStorage.setItem(
      'run-wizard-draft',
      JSON.stringify({
        step: 3,
        workload: 'scenario',
        scenarioState: { service: 'redis', scenario: 'restart', fields: {}, inputObj: {} },
        commandState: {},
        hostCriteria: {},
        options: { dryRun: false },
      }),
    );

    renderWizardWithRoutes();
    const user = userEvent.setup();

    // Didn't crash with a white screen: Step 1 rendered, default workload=scenario.
    expect(screen.getByLabelText('Scenario apply')).toBeChecked();

    // Defaults applied — walk through the wizard from scratch without errors.
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    // Empty regex -> matched=[] (step blocked) — the test only checks there's no crash.
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
  });

  it('Stale draft of a previous version (v differs) → discarded, defaults without crash', async () => {
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    // Previous form version (v=3, scenarioState without incarnationRegex). loadDraft
    // discards it on version mismatch -> the wizard starts from defaults, no crash.
    sessionStorage.setItem(
      'run-wizard-draft',
      JSON.stringify({
        v: 3,
        step: 3,
        workload: 'scenario',
        scenarioState: { service: 'redis', scenario: 'restart', incarnations: null, fields: {}, inputObj: {} },
        commandState: {},
        hostCriteria: {},
        options: {},
      }),
    );

    renderWizardWithRoutes();
    // Version mismatch -> start on Step 1 with default workload=scenario.
    expect(screen.getByLabelText('Scenario apply')).toBeChecked();
  });

  it('Valid fresh draft (v=10, incarnationRegex) → state is restored', async () => {
    setupFetchStub({ incarnationNames: ['redis-prod', 'redis-staging'] });
    sessionStorage.setItem(
      'run-wizard-draft',
      JSON.stringify({
        v: 10,
        step: 3,
        workload: 'scenario',
        runMode: 'voyage',
        cadenceState: { cadenceName: '', scheduleKind: 'interval', intervalSeconds: '3600', cronExpr: '', overlapPolicy: 'skip' },
        scenarioState: {
          service: 'redis',
          scenario: 'restart',
          incarnationRegex: '^redis-prod$',
          incarnations: ['redis-prod'],
          fields: {},
          inputObj: {},
        },
        commandState: {
          moduleName: 'core.cmd',
          moduleState: 'shell',
          moduleStates: ['shell'],
          moduleKind: 'core',
          moduleParams: [],
          paramFields: {},
          timeoutSeconds: 30,
          customModule: '',
          customInput: {},
        },
        hostCriteria: { incarnations: [], covens: [], sidRegex: '', soulprint: '' },
        options: {
          batch: '',
          maxFailures: '',
          concurrency: '50',
          onFailure: 'abort',
          dryRun: false,
          wait: false,
          scheduleAt: '',
          batchMode: 'barrier',
          interBatchIntervalMs: '',
          interUnitIntervalMs: '',
          requireAlive: false,
        },
      }),
    );

    renderWizardWithRoutes();
    // Restored on Step 3; regex preserved -> matches only redis-prod (not staging).
    expect((screen.getByLabelText('Incarnation regex') as HTMLInputElement).value).toBe('^redis-prod$');
    await waitFor(() => {
      const list = screen.getByLabelText('Matched incarnations').textContent ?? '';
      expect(list).toContain('redis-prod');
      expect(list).not.toContain('redis-staging');
    });
  });

  it('Batch size: invalid value → inline error visible, submit disabled', async () => {
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());
    // Invalid format (letters — not N|N%).
    await user.type(screen.getByLabelText('Batch'), 'abc');

    // Inline error appeared.
    await waitFor(() =>
      expect(
        screen.getByText(/Format: integer/),
      ).toBeInTheDocument(),
    );
    // Submit blocked.
    expect(screen.getByRole('button', { name: /Run/ })).toBeDisabled();
  });

  it('Batch: valid value N → no error, submit not disabled', async () => {
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Batch'), '5');

    expect(
      screen.queryByText(/Format: integer/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Run/ })).not.toBeDisabled();
  });

  it('Batch: valid value N% → no error, submit not disabled', async () => {
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Batch'), '20%');

    expect(
      screen.queryByText(/Format: integer/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Run/ })).not.toBeDisabled();
  });

  it('Batch: empty field → no error (field is optional)', async () => {
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());
    // Don't enter anything — field is empty.

    expect(
      screen.queryByText(/Format: integer/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Run/ })).not.toBeDisabled();
  });

  it('Pre-fill ?workload=command&target_coven=prod → host-criteria coven', async () => {
    setupFetchStub({ souls: [{ sid: 'host-a.example.com', covens: ['prod'] }] });
    renderWizardWithRoutes('/run?workload=command&target_coven=prod');
    // Workload=command selected.
    expect(screen.getByLabelText('Command')).toBeChecked();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    // Coven criterion pre-filled (chip 'prod').
    await waitFor(() => expect(screen.getByLabelText('Coven labels').textContent).toContain('prod'));
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
  });

  // The receiving half of NIM-443: the Hosts tab hands over the roster it showed
  // as an explicit SID list, so the run must reach exactly those hosts. The
  // fixture's third soul carries the incarnation's name as a Coven label and is
  // NOT in the list — under the old coven-targeted link it was the only one the
  // run would have reached.
  it('Pre-fill ?workload=command&target_sids → exactly those hosts, coven label ignored', async () => {
    setupFetchStub({
      souls: [
        { sid: 'host-a.example.com', covens: ['dev'] },
        { sid: 'host-b.example.com', covens: ['dev'] },
        { sid: 'labelled-nonmember.example.com', covens: ['hello-dev'] },
      ],
    });
    renderWizardWithRoutes('/run?workload=command&target_sids=host-a.example.com%2Chost-b.example.com');
    expect(screen.getByLabelText('Command')).toBeChecked();
    await userEvent.setup().click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/2 hosts match/));
    const preview = screen.getByLabelText('Host preview').textContent ?? '';
    expect(preview).toContain('host-a.example.com');
    expect(preview).toContain('host-b.example.com');
    expect(preview).not.toContain('labelled-nonmember.example.com');
  });

  // The receiving half of NIM-451. The Hosts tab stopped spelling out its roster
  // in the link — over 2000 hosts that URL was 52 KB and a reload of it answered
  // 431, Keeper capping request headers at 16 KiB on purpose — and hands over the
  // incarnation's NAME instead. So the wizard has to turn that name into hosts,
  // and it must do it through the membership roster, not the Coven column that
  // carries the same name: the fixture below disagrees in both directions, so a
  // resolver reading the column targets the wrong host at the same count.
  it('Pre-fill ?workload=command&target_incarnation → the roster, resolved fresh, not the coven label', async () => {
    const stub = setupFetchStub({
      souls: [
        // On the roster, never labelled.
        { sid: 'db-1.example.com', covens: ['prod'] },
        // Labelled with the incarnation's name, not on its roster.
        { sid: 'web-1.example.com', covens: ['redis-prod'] },
      ],
      members: { 'redis-prod': ['db-1.example.com'] },
    });
    renderWizardWithRoutes('/run?workload=command&target_incarnation=redis-prod');
    expect(screen.getByLabelText('Command')).toBeChecked();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    // The criterion arrived as a criterion, not as a SID list.
    await waitFor(() =>
      expect(screen.getByLabelText('Incarnations criterion').textContent).toContain('redis-prod'),
    );
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    const preview = screen.getByLabelText('Host preview').textContent ?? '';
    expect(preview).toContain('db-1.example.com');
    expect(preview).not.toContain('web-1.example.com');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Concurrency')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    // What actually goes to the backend is still an explicit SID list — the name
    // is resolved here, so this is the assertion that the link means the roster.
    const body = stub.posted?.body as { target: { sids: string[] } };
    expect(body.target.sids).toEqual(['db-1.example.com']);
  });

  // A link that names an incarnation the caller cannot read must not quietly
  // become "no hosts, run anyway" — the run has to stay blocked, and the reason
  // has to be on screen. Same rule NIM-449 wrote for a typed-in name; this only
  // checks that arriving by link does not route around it.
  it('?target_incarnation naming an unreadable roster → named as unresolved, run stays blocked', async () => {
    setupFetchStub({
      souls: [{ sid: 'db-1.example.com', covens: ['prod'] }],
      // No roster for this name → 404 from the fixture, as the keeper answers.
      members: {},
    });
    renderWizardWithRoutes('/run?workload=command&target_incarnation=ghost-prod');
    await userEvent.setup().click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/0 hosts match/));
    expect(screen.getByLabelText('Incarnations criterion').textContent).toContain('ghost-prod');
    // Named with its cause, not silently read as an empty incarnation.
    expect(await screen.findByText(/Unknown incarnation: ghost-prod/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
  });

  // --- Tests S-W5 (updated for S6): batch_mode / max_failures / require_alive ---

  async function reachStep4Command() {
    const stub = setupFetchStub({ souls: [{ sid: 'db-1.example.com', covens: ['prod'] }] });
    renderWizardWithRoutes();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'prod ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Concurrency')).toBeInTheDocument());
    return { stub, user };
  }

  it('batch_mode=window → Batch field hidden, concurrency hint changed', async () => {
    await reachStep4Command();
    // Default barrier — Batch visible.
    expect(screen.getByLabelText('Batch')).toBeInTheDocument();

    // Switch to window.
    await userEvent.setup().click(screen.getByLabelText('batch_mode_window'));
    // Batch field hidden.
    expect(screen.queryByLabelText('Batch')).not.toBeInTheDocument();
    // concurrency hint contains a sliding window description.
    await waitFor(() => {
      const hint = document.querySelector('[aria-label="Concurrency"]')?.closest('label')?.textContent ?? '';
      expect(hint).toMatch(/window/i);
    });
  });

  it('batch_mode=window → batch/batch_size not sent in POST', async () => {
    const { stub, user } = await reachStep4Command();
    await user.click(screen.getByLabelText('batch_mode_window'));
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    expect(body.batch_mode).toBe('window');
    expect('batch' in body).toBe(false);
    expect('batch_size' in body).toBe(false);
  });

  it('batch_mode=barrier (default) → batch_mode=barrier in POST, no extra fields', async () => {
    const { stub, user } = await reachStep4Command();
    // Default barrier, don't touch anything.
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    expect(body.batch_mode).toBe('barrier');
    expect('batch_percent' in body).toBe(false);
    expect('inter_unit_interval_ms' in body).toBe(false);
  });

  it('batch string 20% sent in POST as a raw string, not a number', async () => {
    const { stub, user } = await reachStep4Command();
    await user.type(screen.getByLabelText('Batch'), '20%');
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    // String "20%" — not converted to number 20; batch_percent is absent.
    expect(body.batch).toBe('20%');
    expect('batch_size' in body).toBe(false);
    expect('batch_percent' in body).toBe(false);
  });

  it('max_failures string filled → sent in POST as max_failures (string)', async () => {
    const { stub, user } = await reachStep4Command();
    await user.type(screen.getByLabelText('Max failures'), '3');
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    expect(body.max_failures).toBe('3');
    expect('fail_threshold' in body).toBe(false);
  });

  it('max_failures empty → not sent in POST', async () => {
    const { stub, user } = await reachStep4Command();
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect('max_failures' in (stub.posted?.body as Record<string, unknown>)).toBe(false);
    expect('fail_threshold' in (stub.posted?.body as Record<string, unknown>)).toBe(false);
  });

  it('require_alive checkbox → sent in POST', async () => {
    const { stub, user } = await reachStep4Command();
    await user.click(screen.getByLabelText('require_alive'));
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect((stub.posted?.body as Record<string, unknown>).require_alive).toBe(true);
  });

  it('require_alive default false → sent in POST as false', async () => {
    const { stub, user } = await reachStep4Command();
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect((stub.posted?.body as Record<string, unknown>).require_alive).toBe(false);
  });

  it('inter_unit_interval_ms field visible only in window, sent in POST', async () => {
    const { stub, user } = await reachStep4Command();
    // Default barrier — inter_unit not visible.
    expect(screen.queryByLabelText('Inter-unit interval ms')).not.toBeInTheDocument();
    // inter_batch visible.
    expect(screen.getByLabelText('Inter-batch interval ms')).toBeInTheDocument();

    // Switch to window.
    await user.click(screen.getByLabelText('batch_mode_window'));
    expect(screen.getByLabelText('Inter-unit interval ms')).toBeInTheDocument();
    // inter_batch hidden in window.
    expect(screen.queryByLabelText('Inter-batch interval ms')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Inter-unit interval ms'), '500');
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    expect(body.inter_unit_interval_ms).toBe(500);
    expect('inter_batch_interval_ms' in body).toBe(false);
  });

  // --- Guard tests: Cadence interval floor (ADR-046/048) ---
  // Invariant: minimum period = CONSTRAINTS.cadenceIntervalSecondsMin (30s from OpenAPI).
  // Tests catch the regression "hardcoded 60" and "floor drifted from the spec".
  // Cadence radio is on Step 4 (Options). Path: Step1->2->3->4, enable Cadence there.

  async function reachStep4Cadence() {
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    // Step 1: run_mode radio is here; enable cadence before moving further.
    await waitFor(() =>
      expect(document.querySelector('input[name="run_mode"][value="cadence"]')).toBeInTheDocument(),
    );
    const cadenceRadioInput = document.querySelector('input[name="run_mode"][value="cadence"]') as HTMLInputElement;
    await user.click(cadenceRadioInput);

    // Step 1 -> Step 2: workload=scenario (default), click Next.
    await user.click(screen.getByRole('button', { name: /Next/ }));
    // Step 2 -> select service and scenario.
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    // Step 3 → incarnation regex.
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );
    await user.click(screen.getByRole('button', { name: /Next/ }));
    // Step 4 -> cadence block appears in Options (runMode='cadence' is already set).
    await waitFor(() => expect(screen.getByTestId('cadence-interval')).toBeInTheDocument());

    return { user };
  }

  it('Cadence: input[min] equals CONSTRAINTS.cadenceIntervalSecondsMin', async () => {
    await reachStep4Cadence();

    const intervalInput = screen.getByTestId('cadence-interval') as HTMLInputElement;
    expect(Number(intervalInput.min)).toBe(CONSTRAINTS.cadenceIntervalSecondsMin);
  });

  it('Cadence: submit validation rejects a value below the floor', async () => {
    const { user } = await reachStep4Cadence();

    // Fill in the Cadence name (required field) and enter a value below the floor.
    const nameInput = screen.getByTestId('cadence-name') as HTMLInputElement;
    await user.type(nameInput, 'test-cadence');

    const intervalInput = screen.getByTestId('cadence-interval');
    fireEvent.change(intervalInput, { target: { value: String(CONSTRAINTS.cadenceIntervalSecondsMin - 1) } });

    // Submit should be blocked (below floor).
    expect(screen.getByRole('button', { name: /Create schedule/ })).toBeDisabled();
  });

  it('Cadence: submit validation accepts a value exactly at the floor', async () => {
    const { user } = await reachStep4Cadence();

    // Fill in the Cadence name and enter a value exactly at the floor.
    const nameInput = screen.getByTestId('cadence-name') as HTMLInputElement;
    await user.type(nameInput, 'test-cadence');

    const intervalInput = screen.getByTestId('cadence-interval');
    fireEvent.change(intervalInput, { target: { value: String(CONSTRAINTS.cadenceIntervalSecondsMin) } });

    // Submit should be unblocked (exactly at floor).
    expect(screen.getByRole('button', { name: /Create schedule/ })).not.toBeDisabled();
  });

  // --- Guard tests S6: batch / max_failures / preview ---

  it('S6: max_failures tooltip present (aria-label)', async () => {
    await reachStep4Command();
    // Tooltip should be in the markup.
    await waitFor(() => expect(screen.getByLabelText(/Threshold is counted/)).toBeInTheDocument());
  });

  it('S6: max_failures string 25% sent as max_failures in POST (not fail_threshold)', async () => {
    const { stub, user } = await reachStep4Command();
    await user.type(screen.getByLabelText('Max failures'), '25%');
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    expect(body.max_failures).toBe('25%');
    expect('fail_threshold' in body).toBe(false);
  });

  it('S6: snapshot target (regex/sids) → batch count stays client-side, preview only pre-flights the target', async () => {
    // Since NIM-450 a snapshot target DOES hit /v1/voyages/preview — as a permission
    // pre-flight, because that endpoint runs the same gates as create. What must not
    // happen is the reply driving the batch display: the client already knows the scope,
    // and a preview answering about a different one would be shown as fact.
    const previewBodies: Record<string, unknown>[] = [];
    setupFetchStub({ souls: [{ sid: 'db-1.example.com', covens: [] }, { sid: 'db-2.example.com', covens: [] }] });
    const baseFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/v1/voyages/preview')) {
        previewBodies.push(JSON.parse(String(init?.body ?? '{}')));
        // Deliberately wrong scope: if the UI ever renders this, the assertion below trips.
        return new Response(
          JSON.stringify({ kind: 'command', scope_size: 99, total_batches: 99, batch_mode: 'barrier' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return baseFetch(input, init);
    }) as typeof fetch);

    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.type(screen.getByLabelText('SID regex'), 'db-.*');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/2 hosts match/));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Batch'), '1');
    await waitFor(() => expect(screen.getByTestId('batch-preview')).toHaveTextContent(/2 batch\(es\) for 2 units/));
    expect(screen.getByTestId('batch-preview')).not.toHaveTextContent('99');

    // The pre-flight asked about exactly the hosts the run would touch.
    await waitFor(() => expect(previewBodies.length).toBeGreaterThan(0));
    expect((previewBodies.at(-1) as { target: { sids: string[] } }).target.sids).toEqual([
      'db-1.example.com',
      'db-2.example.com',
    ]);
  });

  it('S6: late-binding coven target → preview endpoint called (debounced)', async () => {
    // Command with coven-only -> late-binding -> preview is called.
    const previewReplies: unknown[] = [];
    setupFetchStub({ souls: [{ sid: 'db-1.example.com', covens: ['prod'] }] });
    const baseFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/v1/voyages/preview')) {
        previewReplies.push('called');
        return new Response(JSON.stringify({
          kind: 'command',
          scope_size: 1,
          total_batches: 1,
          batch_mode: 'barrier',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return baseFetch(input, init);
    }) as typeof fetch);

    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'prod ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());

    // Preview should be called (after debounce).
    await waitFor(() => expect(previewReplies.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(previewReplies.length).toBeGreaterThan(0);
  });

  it('S6: window batch_mode → batch preview shows window message (not null)', async () => {
    // For a snapshot-target with 1 incarnation, window mode.
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Next/ }));
    // Switch to window — batch field hidden, batch-preview not shown.
    await waitFor(() => expect(screen.getByLabelText('batch_mode_window')).toBeInTheDocument());
    await user.click(screen.getByLabelText('batch_mode_window'));
    // batch field hidden.
    expect(screen.queryByLabelText('Batch')).not.toBeInTheDocument();
    // batch-preview under the batch field is not shown (isWindow=true hides the block).
    expect(screen.queryByTestId('batch-preview')).not.toBeInTheDocument();
  });

  it('S6: snapshot scenario target + batch 2 → local batch preview shown (~1 batch for 1 incarnation)', async () => {
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Batch'), '2');

    // Scope=1 incarnation, batch=2 -> ceil(1/2)=1 batch. batch-preview appeared.
    await waitFor(() => expect(screen.getByTestId('batch-preview')).toBeInTheDocument());
    expect(screen.getByTestId('batch-preview').textContent).toMatch(/1/);
  });

  it('S6: 422 from preview/create → keeper detail shown in submitError', async () => {
    setupFetchStub({ souls: [{ sid: 'db-1.example.com', covens: ['prod'] }] });
    const baseFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && (url.endsWith('/v1/voyages') || url.includes('/v1/voyages?'))) {
        return new Response(JSON.stringify({ code: 'voyage_batch_spec_conflict', message: 'batch spec conflict' }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return baseFetch(input, init);
    }) as typeof fetch);

    renderWizardWithRoutes();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'prod ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Run/ }));

    // 422 error from keeper shown in submitError.
    await waitFor(() =>
      expect(screen.getByText(/422|batch spec conflict/)).toBeInTheDocument(),
    );
  });
});

// --- Notify block RunWizard (ADR-052(g) amendment N2) ---

describe('RunWizard — notify block Step 4', () => {
  beforeEach(() => {
    tokenStore.clear();
    sessionStorage.clear();
  });

  /**
   * Helper function: walks the wizard Scenario steps up to Step 4 (Options).
   * Returns a stub for checking posts.
   */
  async function reachStep4Scenario(user: ReturnType<typeof userEvent.setup>) {
    const stub = setupFetchStubWithHeralds(['ops-webhook']);
    renderWizardWithRoutes();

    // Step 1 → 2
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    // Step 2 → 3
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    // Step 3 → 4
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('notify-block')).toBeInTheDocument());

    return stub;
  }

  it('notify block visible on Step 4 (voyage mode)', async () => {
    const user = userEvent.setup();
    await reachStep4Scenario(user);
    expect(screen.getByTestId('notify-block')).toBeInTheDocument();
  });

  it('the Add notification button creates a new notify item', async () => {
    const user = userEvent.setup();
    await reachStep4Scenario(user);

    await user.click(screen.getByTestId('notify-add-btn'));
    await waitFor(() => expect(screen.getByTestId('notify-item-0')).toBeInTheDocument());
    expect(screen.getByTestId('notify-herald-select-0')).toBeInTheDocument();
  });

  it('selecting a Herald and submitting carries notify[] in POST /v1/voyages', async () => {
    const user = userEvent.setup();
    const stub = await reachStep4Scenario(user);

    // Add a notify item.
    await user.click(screen.getByTestId('notify-add-btn'));
    await waitFor(() => expect(screen.getByTestId('notify-herald-select-0')).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('notify-herald-select-0'), 'ops-webhook');

    // Submit.
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const voyagePost = stub.posts.find((p) => p.url.includes('/v1/voyages') && !p.url.includes('/preview'));
    expect(voyagePost).toBeDefined();
    const body = voyagePost!.body as { notify?: Array<{ herald: string }> };
    expect(body.notify).toBeDefined();
    expect(body.notify![0].herald).toBe('ops-webhook');
  });

  it('a notify item with an empty herald is not included in POST', async () => {
    const user = userEvent.setup();
    const stub = await reachStep4Scenario(user);

    // Add a notify item, but don't select Herald.
    await user.click(screen.getByTestId('notify-add-btn'));
    await waitFor(() => expect(screen.getByTestId('notify-item-0')).toBeInTheDocument());

    // Submit without Herald.
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const voyagePost = stub.posts.find((p) => p.url.includes('/v1/voyages') && !p.url.includes('/preview'));
    expect(voyagePost).toBeDefined();
    const body = voyagePost!.body as { notify?: unknown };
    // Empty herald -> don't send notify.
    expect(body.notify).toBeUndefined();
  });

  it('the Remove button removes a notify item', async () => {
    const user = userEvent.setup();
    await reachStep4Scenario(user);

    await user.click(screen.getByTestId('notify-add-btn'));
    await waitFor(() => expect(screen.getByTestId('notify-item-0')).toBeInTheDocument());

    await user.click(screen.getByTestId('notify-remove-0'));
    await waitFor(() => expect(screen.queryByTestId('notify-item-0')).not.toBeInTheDocument());
  });

  // Guard: regression — the "add" annotation button didn't add a row
  // (kvToAnnotations dropped an empty key -> annotations: undefined -> the row disappeared).
  it('GUARD: the add-annotation button adds an editable row (key+value)', async () => {
    const user = userEvent.setup();
    await reachStep4Scenario(user);

    // Add a notify item.
    await user.click(screen.getByTestId('notify-add-btn'));
    await waitFor(() => expect(screen.getByTestId('notify-item-0')).toBeInTheDocument());

    // Open advanced fields.
    await user.click(screen.getByTestId('notify-advanced-toggle-0'));

    // Click "add annotation".
    await user.click(screen.getByTestId('notify-annotation-add'));

    // The row should appear (key and value fields).
    await waitFor(() => {
      expect(screen.getByLabelText('annotation key 0')).toBeInTheDocument();
      expect(screen.getByLabelText('annotation value 0')).toBeInTheDocument();
    });
  });

  // Guard: filled-in annotations end up in POST /v1/voyages.
  it('GUARD: filled-in annotations end up in POST body', async () => {
    const user = userEvent.setup();
    const stub = await reachStep4Scenario(user);

    // Add a notify item with Herald.
    await user.click(screen.getByTestId('notify-add-btn'));
    await waitFor(() => expect(screen.getByTestId('notify-herald-select-0')).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('notify-herald-select-0'), 'ops-webhook');

    // Open advanced fields.
    await user.click(screen.getByTestId('notify-advanced-toggle-0'));

    // Add an annotation.
    await user.click(screen.getByTestId('notify-annotation-add'));
    await waitFor(() => expect(screen.getByLabelText('annotation key 0')).toBeInTheDocument());
    await user.type(screen.getByLabelText('annotation key 0'), 'env');
    await user.type(screen.getByLabelText('annotation value 0'), 'prod');

    // Submit.
    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const voyagePost = stub.posts.find((p) => p.url.includes('/v1/voyages') && !p.url.includes('/preview'));
    expect(voyagePost).toBeDefined();
    const body = voyagePost!.body as { notify?: Array<{ herald: string; annotations?: Record<string, string> }> };
    expect(body.notify).toBeDefined();
    expect(body.notify![0].herald).toBe('ops-webhook');
    expect(body.notify![0].annotations).toMatchObject({ env: 'prod' });
  });
});

/**
 * Variant of setupFetchStub with heralds-request support (for the notify block).
 */
function setupFetchStubWithHeralds(heraldNames: string[]) {
  const base = setupFetchStub({ incarnationNames: ['redis-prod'] });
  const origFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (url.startsWith('/v1/heralds')) {
      const items = heraldNames.map((name) => ({
        name,
        type: 'webhook' as const,
        config: { url: `https://example.com/${name}` },
        enabled: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      return new Response(JSON.stringify({ items, offset: 0, limit: 200, total: items.length }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return origFetch(input, init);
  }) as typeof fetch);
  return base;
}

/**
 * NIM-450: an explicit SID target the operator cannot narrow.
 *
 * Since NIM-443 the roster button and Bulk Run both hand the wizard a concrete host list.
 * That list resolves under `soul.list`; the run is authorized under `errand.run`. When the
 * latter is narrower the backend does not trim — it refuses the whole run (403 naming the
 * host), which is the honest answer but left the operator with a target wired into a link
 * and no way to act on it.
 */
describe('RunWizard — narrowing an explicit host target (NIM-450)', () => {
  beforeEach(() => {
    tokenStore.set('test-token');
  });

  const SOULS = [
    { sid: 'db-1.example.com', covens: ['prod'] },
    { sid: 'db-2.example.com', covens: ['prod'] },
  ];

  // Drives the wizard from a bulk-run link (the shape MembersPanel and SoulsList emit)
  // to step 4, with the pre-flight answering however the caller says.
  async function reachStep4FromLink(previewReply: (body: Record<string, unknown>) => Response) {
    const stub = setupFetchStub({ souls: SOULS });
    const baseFetch = globalThis.fetch;
    const previewBodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/v1/voyages/preview')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        previewBodies.push(body);
        return previewReply(body);
      }
      return baseFetch(input, init);
    }) as typeof fetch);

    renderWizardWithRoutes('/run?workload=command&target_sids=db-1.example.com,db-2.example.com');
    const user = userEvent.setup();
    // A deep link pre-fills the criteria but still opens on step 1 (workload).
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/2 hosts match/));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Concurrency')).toBeInTheDocument());
    return { stub, user, previewBodies };
  }

  const ok = () =>
    new Response(JSON.stringify({ kind: 'command', scope_size: 2, total_batches: 1, batch_mode: 'barrier' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  const deniedOn = (sid: string) =>
    new Response(
      JSON.stringify({
        type: 'https://soul-stack.com/errors/forbidden',
        title: 'Forbidden',
        status: 403,
        detail: `operator lacks errand.run on target host ${sid}`,
      }),
      { status: 403, headers: { 'Content-Type': 'application/problem+json' } },
    );

  it('a host unchecked in the Hosts step leaves the submitted target', async () => {
    const stub = setupFetchStub({ souls: SOULS });
    renderWizardWithRoutes('/run?workload=command&target_sids=db-1.example.com,db-2.example.com');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/2 hosts match/));
    await user.click(screen.getByLabelText('Include db-2.example.com in the target'));
    await waitFor(() => expect(screen.getByTestId('hosts-excluded')).toHaveTextContent('1 dropped'));

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Concurrency')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /^Run$/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const post = stub.posts.find((p) => p.url.includes('/v1/voyages') && !p.url.includes('/preview'));
    expect((post!.body as { target: { sids: string[] } }).target.sids).toEqual(['db-1.example.com']);
  });

  it('unchecking every host blocks Next instead of submitting an empty run', async () => {
    setupFetchStub({ souls: SOULS });
    renderWizardWithRoutes('/run?workload=command&target_sids=db-1.example.com,db-2.example.com');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/2 hosts match/));
    await user.click(screen.getByLabelText('Include db-1.example.com in the target'));
    await user.click(screen.getByLabelText('Include db-2.example.com in the target'));

    await waitFor(() => expect(screen.getByTestId('hosts-all-excluded')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
  });

  it('the pre-flight surfaces the refusal before submit and drops the host it names', async () => {
    const excluded = new Set<string>();
    const { user, previewBodies } = await reachStep4FromLink((body) => {
      const sids = (body as { target: { sids: string[] } }).target.sids;
      const denied = sids.find((s) => s === 'db-2.example.com' && !excluded.has(s));
      return denied ? deniedOn(denied) : ok();
    });

    const banner = await screen.findByTestId('preflight-denied', {}, { timeout: PREFLIGHT_WAIT });
    expect(banner).toHaveTextContent('operator lacks errand.run on target host db-2.example.com');

    await user.click(screen.getByRole('button', { name: /Drop db-2.example.com from the target/ }));
    excluded.add('db-2.example.com');

    // Clearing needs the debounce plus a round trip, same as raising it did.
    await waitFor(() => expect(screen.queryByTestId('preflight-denied')).not.toBeInTheDocument(), {
      timeout: PREFLIGHT_WAIT,
    });
    await waitFor(
      () => expect((previewBodies.at(-1) as { target: { sids: string[] } }).target.sids).toEqual(['db-1.example.com']),
      { timeout: PREFLIGHT_WAIT },
    );
  });

  it('a pre-flight failure that is not a 403 never stands between the operator and the run', async () => {
    // Tempo throttling, a network blip, a keeper that has not got the endpoint: none of
    // these prove the run is forbidden, and the backend still gets the final word on submit.
    const { stub, user, previewBodies } = await reachStep4FromLink(
      () =>
        new Response(JSON.stringify({ status: 429, title: 'Too Many Requests', detail: 'tempo exceeded' }), {
          status: 429,
          headers: { 'Content-Type': 'application/problem+json' },
        }),
    );

    // The pre-flight must have actually run and failed first — asserting the banner is
    // absent before the request even fires proves nothing. Then give the failure the same
    // window the 403 case needs to paint its banner, and require that none appears.
    await waitFor(() => expect(previewBodies.length).toBeGreaterThan(0), { timeout: PREFLIGHT_WAIT });
    await expect(screen.findByTestId('preflight-denied', {}, { timeout: NEVER_APPEARS_WAIT })).rejects.toThrow();

    await user.click(screen.getByRole('button', { name: /^Run$/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());
    const post = stub.posts.find((p) => p.url.includes('/v1/voyages') && !p.url.includes('/preview'));
    expect((post!.body as { target: { sids: string[] } }).target.sids).toEqual([
      'db-1.example.com',
      'db-2.example.com',
    ]);
  });

  it('a Cadence is not pre-flighted: its create checks errand.run bare and resolves at spawn', async () => {
    const previewBodies: Record<string, unknown>[] = [];
    setupFetchStub({ souls: SOULS });
    const baseFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/v1/voyages/preview')) {
        previewBodies.push(JSON.parse(String(init?.body ?? '{}')));
        return deniedOn('db-2.example.com');
      }
      return baseFetch(input, init);
    }) as typeof fetch);

    renderWizardWithRoutes('/run?workload=command&target_sids=db-1.example.com,db-2.example.com&recurrence=true');
    const user = userEvent.setup();
    // A deep link pre-fills the criteria but still opens on step 1 (workload).
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/2 hosts match/));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('cadence-name')).toBeInTheDocument());

    // Assert the silence AFTER the window in which a probe would have gone out: the target
    // key is debounced by 400ms, so checking on arrival at step 4 proves only that the
    // clock has not run yet. A one-off run in this same state fires within this budget —
    // see the sibling voyage tests.
    await new Promise((resolve) => setTimeout(resolve, NEVER_APPEARS_WAIT));
    expect(previewBodies).toHaveLength(0);
    expect(screen.queryByTestId('preflight-denied')).not.toBeInTheDocument();
  });

  it('dropping a host from a coven target sends the snapshot, not the coven the tick would re-resolve', async () => {
    const cadencePosts: Record<string, unknown>[] = [];
    setupFetchStub({ souls: SOULS });
    const baseFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if ((init?.method ?? 'GET').toUpperCase() === 'POST' && url.includes('/v1/cadences')) {
        cadencePosts.push(JSON.parse(String(init?.body ?? '{}')));
        return new Response(JSON.stringify({ cadence_id: 'cad-01' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return baseFetch(input, init);
    }) as typeof fetch);

    renderWizardWithRoutes('/run?workload=command&target_coven=prod&recurrence=true');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/2 hosts match/));
    await user.click(screen.getByLabelText('Include db-2.example.com in the target'));
    await waitFor(() => expect(screen.getByTestId('cadence-excluded-snapshot-warn')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.type(screen.getByTestId('cadence-name'), 'nightly-uptime');
    await user.click(screen.getByRole('button', { name: /Create schedule/ }));

    await waitFor(() => expect(cadencePosts).toHaveLength(1));
    const target = (cadencePosts[0] as { target: { sids?: string[]; coven?: string[] } }).target;
    expect(target.sids).toEqual(['db-1.example.com']);
    expect(target.coven).toBeUndefined();
  });
});

/**
 * NIM-450 follow-ups from review: the pre-flight must not speak for a flow it does not
 * describe, and dropping a host must be reversible and self-explaining.
 */
describe('RunWizard — pre-flight boundaries and reversibility (NIM-450)', () => {
  beforeEach(() => {
    tokenStore.set('test-token');
  });

  const SOULS = [
    { sid: 'db-1.example.com', covens: ['prod'] },
    { sid: 'db-2.example.com', covens: ['prod'] },
  ];

  const deniedOn = (sid: string) =>
    new Response(
      JSON.stringify({
        type: 'https://soul-stack.com/errors/forbidden',
        title: 'Forbidden',
        status: 403,
        detail: `operator lacks errand.run on target host ${sid}`,
      }),
      { status: 403, headers: { 'Content-Type': 'application/problem+json' } },
    );

  const previewOk = (scope: number, batches: number) =>
    new Response(
      JSON.stringify({ kind: 'command', scope_size: scope, total_batches: batches, batch_mode: 'barrier' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  // Layers a pre-flight answer over the shared stub. MUST run after setupFetchStub —
  // that one replaces global fetch wholesale and would otherwise swallow this.
  function stubPreview(reply: (body: Record<string, unknown>) => Response) {
    const bodies: Record<string, unknown>[] = [];
    const baseFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/v1/voyages/preview')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        bodies.push(body);
        return reply(body);
      }
      return baseFetch(input, init);
    }) as typeof fetch);
    return bodies;
  }

  // Walks a pre-filled link to the Options step with `uptime` as the command.
  async function walkToOptions(query: string, user: ReturnType<typeof userEvent.setup>) {
    renderWizardWithRoutes(query);
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/2 hosts match/));
  }

  async function fillCommandAndAdvance(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Next/ }));
  }

  it('a dropped host goes back into the target when re-checked', async () => {
    const stub = setupFetchStub({ souls: SOULS });
    const user = userEvent.setup();
    await walkToOptions('/run?workload=command&target_sids=db-1.example.com,db-2.example.com', user);

    const box = () => screen.getByLabelText('Include db-2.example.com in the target');
    await user.click(box());
    await waitFor(() => expect(screen.getByTestId('hosts-excluded')).toHaveTextContent('1 dropped'));
    await user.click(box());
    await waitFor(() => expect(screen.queryByTestId('hosts-excluded')).not.toBeInTheDocument());

    await fillCommandAndAdvance(user);
    await waitFor(() => expect(screen.getByLabelText('Concurrency')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /^Run$/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const post = stub.posts.find((p) => p.url.includes('/v1/voyages') && !p.url.includes('/preview'));
    expect((post!.body as { target: { sids: string[] } }).target.sids).toEqual([
      'db-1.example.com',
      'db-2.example.com',
    ]);
  });

  it('a coven target with a dropped host is counted as the snapshot it will submit', async () => {
    // Without the exclusion forcing the snapshot form, step 4 would count batches over the
    // coven Keeper re-resolves (2 hosts) while the run leaves as a snapshot of 1 — the
    // number on screen would describe a different run than the one that goes.
    setupFetchStub({ souls: SOULS });
    const bodies = stubPreview(() => previewOk(2, 2));
    const user = userEvent.setup();
    await walkToOptions('/run?workload=command&target_coven=prod', user);

    await user.click(screen.getByLabelText('Include db-2.example.com in the target'));
    await waitFor(() => expect(screen.getByTestId('hosts-excluded')).toHaveTextContent('1 dropped'));

    await fillCommandAndAdvance(user);
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Batch'), '1');

    await waitFor(() => expect(screen.getByTestId('batch-preview')).toHaveTextContent(/1 batch\(es\) for 1 units/));
    // And the probe asked about the snapshot, never about the coven.
    await waitFor(() => expect(bodies.length).toBeGreaterThan(0), { timeout: PREFLIGHT_WAIT });
    expect(bodies.every((b) => (b as { target: { coven?: string[] } }).target.coven === undefined)).toBe(true);
  });

  it('a Cadence gets no denial banner even when the pre-flight endpoint refuses', async () => {
    // A coven target keeps the preview call alive (it is what counts the batches), but a
    // cadence recipe is authorized BARE and its target resolved only at spawn — a per-host
    // refusal here describes a run that is not the one being created.
    setupFetchStub({ souls: SOULS });
    const bodies = stubPreview(() => deniedOn('db-2.example.com'));
    const user = userEvent.setup();
    await walkToOptions('/run?workload=command&target_coven=prod&recurrence=true', user);

    await fillCommandAndAdvance(user);
    await waitFor(() => expect(screen.getByTestId('cadence-name')).toBeInTheDocument());

    // The probe really ran and really refused; the banner still must not appear.
    await waitFor(() => expect(bodies.length).toBeGreaterThan(0), { timeout: PREFLIGHT_WAIT });
    await expect(screen.findByTestId('preflight-denied', {}, { timeout: NEVER_APPEARS_WAIT })).rejects.toThrow();
  });

  it('toggling require_alive re-asks the pre-flight instead of keeping the old verdict', async () => {
    setupFetchStub({ souls: SOULS });
    const bodies = stubPreview((body) =>
      (body as { require_alive?: boolean }).require_alive ? previewOk(1, 1) : deniedOn('db-2.example.com'),
    );
    const user = userEvent.setup();
    await walkToOptions('/run?workload=command&target_sids=db-1.example.com,db-2.example.com', user);
    await fillCommandAndAdvance(user);
    await waitFor(() => expect(screen.getByLabelText('Concurrency')).toBeInTheDocument());

    await screen.findByTestId('preflight-denied', {}, { timeout: PREFLIGHT_WAIT });
    await user.click(screen.getByLabelText('require_alive'));

    await waitFor(() => expect(bodies.some((b) => (b as { require_alive?: boolean }).require_alive)).toBe(true), {
      timeout: PREFLIGHT_WAIT,
    });
    await waitFor(() => expect(screen.queryByTestId('preflight-denied')).not.toBeInTheDocument(), {
      timeout: PREFLIGHT_WAIT,
    });
  });

  it('dropping the last host explains itself on the Options step, not two steps away', async () => {
    // The refusal always names whichever host is still first, so the Drop button walks the
    // target down to empty — and the Hosts step's own "nothing left" warning is not here.
    setupFetchStub({ souls: SOULS });
    stubPreview((body) => deniedOn((body as { target: { sids: string[] } }).target.sids[0]));
    const user = userEvent.setup();
    await walkToOptions('/run?workload=command&target_sids=db-1.example.com,db-2.example.com', user);
    await fillCommandAndAdvance(user);
    await waitFor(() => expect(screen.getByLabelText('Concurrency')).toBeInTheDocument());

    const dropName = /Drop (.*) from the target/;
    const first = await screen.findByRole('button', { name: dropName }, { timeout: PREFLIGHT_WAIT });
    const firstLabel = first.textContent ?? '';
    await user.click(first);
    // Wait for the NEXT verdict — the same button text would mean the refetch has not
    // landed and a second click would re-drop the host already gone.
    const second = await screen.findByRole(
      'button',
      { name: (name: string) => dropName.test(name) && name !== firstLabel },
      { timeout: PREFLIGHT_WAIT },
    );
    await user.click(second);

    await waitFor(() => expect(screen.getByTestId('target-empty-after-drop')).toBeInTheDocument(), {
      timeout: PREFLIGHT_WAIT,
    });
    expect(screen.getByRole('button', { name: /^Run$/ })).toBeDisabled();
  });
});

/**
 * NIM-450, third review pass: branches the earlier tests reached past without touching.
 */
describe('RunWizard — pre-flight branches the happy path skips (NIM-450)', () => {
  beforeEach(() => {
    tokenStore.set('test-token');
  });

  const SOULS = [
    { sid: 'db-1.example.com', covens: ['prod'] },
    { sid: 'db-2.example.com', covens: ['prod'] },
  ];

  const deniedOn = (sid: string) =>
    new Response(
      JSON.stringify({
        type: 'https://soul-stack.com/errors/forbidden',
        title: 'Forbidden',
        status: 403,
        detail: `operator lacks errand.run on target host ${sid}`,
      }),
      { status: 403, headers: { 'Content-Type': 'application/problem+json' } },
    );

  it('a refusal on a coven target is reported without blaming a host', async () => {
    // A late-binding target has no snapshot to drop a host from — the console gate can
    // still refuse it per host. Naming one anyway would send the operator to remove a
    // host the target never listed.
    setupFetchStub({ souls: SOULS });
    const baseFetch = globalThis.fetch;
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/v1/voyages/preview')) {
        bodies.push(JSON.parse(String(init?.body ?? '{}')));
        return deniedOn('db-2.example.com');
      }
      return baseFetch(input, init);
    }) as typeof fetch);

    renderWizardWithRoutes('/run?workload=command&target_coven=prod');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/2 hosts match/));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Next/ }));

    const banner = await screen.findByTestId('preflight-denied', {}, { timeout: PREFLIGHT_WAIT });
    expect(banner).toHaveTextContent('operator lacks errand.run on target host db-2.example.com');
    expect(within(banner).queryByRole('button')).toBeNull();
    // It really was the coven that was asked about.
    expect((bodies.at(-1) as { target: { coven?: string[] } }).target.coven).toEqual(['prod']);
  });

  it('switching the module re-asks instead of carrying the old verdict over', async () => {
    // The console gate is per module: a refusal earned by core.cmd.shell says nothing
    // about core.noop.
    setupFetchStub({ souls: SOULS });
    const baseFetch = globalThis.fetch;
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/v1/voyages/preview')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { module?: string };
        bodies.push(body);
        return String(body.module).startsWith('core.cmd')
          ? deniedOn('db-2.example.com')
          : new Response(
              JSON.stringify({ kind: 'command', scope_size: 2, total_batches: 1, batch_mode: 'barrier' }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
      }
      return baseFetch(input, init);
    }) as typeof fetch);

    renderWizardWithRoutes('/run?workload=command&target_sids=db-1.example.com,db-2.example.com');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/2 hosts match/));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await screen.findByTestId('preflight-denied', {}, { timeout: PREFLIGHT_WAIT });

    // Back to Params, pick a module the gate does not cover.
    await user.click(screen.getByRole('button', { name: /3\.\s*Params/ }));
    await waitFor(() => expect(screen.getByTestId('module-picker-control')).toBeInTheDocument());
    await user.click(screen.getByTestId('module-picker-control'));
    await user.type(screen.getByTestId('module-picker-search'), 'exec');
    await user.click(await screen.findByTestId('module-option-core.exec'));
    // Switching modules resets the params form; the step gate needs it filled again.
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toHaveValue(''));
    await user.type(screen.getByTestId('field-multiline-cmd'), '/usr/bin/uptime');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Concurrency')).toBeInTheDocument());

    await waitFor(
      () => expect(bodies.some((b) => String((b as { module?: string }).module).startsWith('core.exec'))).toBe(true),
      { timeout: PREFLIGHT_WAIT },
    );
    await waitFor(() => expect(screen.queryByTestId('preflight-denied')).not.toBeInTheDocument(), {
      timeout: PREFLIGHT_WAIT,
    });
  });

  it('a Cadence on an explicit host list is not warned about coven re-resolution', async () => {
    // That warning explains why a coven target degrades to a snapshot. A target that was
    // a snapshot to begin with has nothing to degrade.
    setupFetchStub({ souls: SOULS });
    renderWizardWithRoutes('/run?workload=command&target_sids=db-1.example.com,db-2.example.com&recurrence=true');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/2 hosts match/));
    await user.click(screen.getByLabelText('Include db-2.example.com in the target'));
    await waitFor(() => expect(screen.getByTestId('hosts-excluded')).toHaveTextContent('1 dropped'));

    expect(screen.queryByTestId('cadence-excluded-snapshot-warn')).not.toBeInTheDocument();
  });

  it('re-scoping past a dropped host restores late-binding instead of freezing a snapshot', async () => {
    // `excluded` is a delta, not a selection: once the criteria no longer resolve to the
    // dropped host, nothing is being dropped and a coven recipe may go back to being
    // resolved on every tick.
    const cadencePosts: Record<string, unknown>[] = [];
    setupFetchStub({
      souls: [
        { sid: 'db-1.example.com', covens: ['prod'] },
        { sid: 'db-2.example.com', covens: ['prod'] },
        { sid: 'web-1.example.com', covens: ['web'] },
      ],
    });
    const baseFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if ((init?.method ?? 'GET').toUpperCase() === 'POST' && url.includes('/v1/cadences')) {
        cadencePosts.push(JSON.parse(String(init?.body ?? '{}')));
        return new Response(JSON.stringify({ cadence_id: 'cad-01' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return baseFetch(input, init);
    }) as typeof fetch);

    renderWizardWithRoutes('/run?workload=command&target_coven=prod&recurrence=true');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/2 hosts match/));
    await user.click(screen.getByLabelText('Include db-2.example.com in the target'));
    await waitFor(() => expect(screen.getByTestId('cadence-excluded-snapshot-warn')).toBeInTheDocument());

    // Move the criteria off the dropped host entirely.
    const covenChip = screen.getByLabelText('Coven labels');
    await user.click(within(covenChip).getByRole('button', { name: /prod/ }));
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'web ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    await waitFor(() => expect(screen.queryByTestId('cadence-excluded-snapshot-warn')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.type(screen.getByTestId('cadence-name'), 'nightly-uptime');
    await user.click(screen.getByRole('button', { name: /Create schedule/ }));

    await waitFor(() => expect(cadencePosts).toHaveLength(1), { timeout: PREFLIGHT_WAIT });
    const target = (cadencePosts[0] as { target: { sids?: string[]; coven?: string[] } }).target;
    expect(target.coven).toEqual(['web']);
    expect(target.sids).toBeUndefined();
  });
});
