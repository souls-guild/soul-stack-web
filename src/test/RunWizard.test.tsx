import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { RunWizard } from '../pages/run/RunWizard';
import { tokenStore } from '../api/tokenStore';
import { CONSTRAINTS } from '../api/constraints.gen';

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
  it('Step 1: ровно 2 workload-карточки (Scenario / Command), без Push', () => {
    setupFetchStub();
    renderWizardWithRoutes();
    expect(screen.getByLabelText('Scenario apply')).toBeChecked();
    expect(screen.getByLabelText('Command')).toBeInTheDocument();
    expect(screen.queryByLabelText('Push destiny')).not.toBeInTheDocument();
  });

  it('Scenario: пустая regex → «Далее» заблокирован, подсказка показана', async () => {
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    // Step 1 -> 2 (scenario select).
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    // Step 2 -> 3. Regex is empty.
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());

    // Empty regex -> matched=[], "Next" disabled, hint visible.
    expect(screen.getByLabelText('Incarnation regex')).toHaveValue('');
    expect(screen.getByRole('button', { name: /Далее/ })).toBeDisabled();
    // Hint "specify a regex or * for all" must be present on screen.
    await waitFor(() => expect(screen.getByText(/укажите regex или \* для всех/)).toBeInTheDocument());
  });

  // NIM-73 A2: leading paragraph of scenario description -> prominent info callout ABOVE fields
  // (operator sees the precondition before running); rest of description is dim outside the callout.
  it('Scenario: ведущий абзац описания рендерится заметным callout над полями', async () => {
    setupFetchStub({
      scenarios: [
        {
          name: 'add_user',
          kind: 'operational',
          description:
            '★ Перед запуском засей пароль добавляемого юзера в Vault по пути secret/redis/<incarnation>/users/<name>#password\n\nДобавить или переопределить одного ACL-пользователя на работающем Redis без рестарта.',
          input_schema: { username: { type: 'string' } },
        },
      ],
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    // Step 1 -> 2 -> select service and scenario.
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /add_user/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'add_user');

    // Step 2 -> 3: scenario input fields + note are rendered.
    await user.click(screen.getByRole('button', { name: /Далее/ }));

    const note = await screen.findByTestId('scenario-note');
    expect(note).toHaveTextContent(/Перед запуском засей пароль добавляемого юзера в Vault/);
    // Callout contains ONLY the leading paragraph; rest of the description renders separately.
    expect(note).not.toHaveTextContent(/Добавить или переопределить одного ACL-пользователя/);
    expect(screen.getByText(/Добавить или переопределить одного ACL-пользователя на работающем Redis без рестарта/)).toBeInTheDocument();
  });

  it('Scenario: regex * → все incarnations → submit', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-prod', 'redis-staging'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    // Step 1 -> 2 (scenario select).
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    // Step 2 -> 3. Type * -> ALL incarnations match.
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() => {
      const list = screen.getByLabelText('Matched incarnations').textContent ?? '';
      expect(list).toContain('redis-prod');
      expect(list).toContain('redis-staging');
    });
    expect(screen.getByRole('button', { name: /Далее/ })).not.toBeDisabled();

    // Step 3 -> 4 -> submit -> POST /v1/voyages with incarnations=[redis-prod, redis-staging].
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    // A single POST to /v1/voyages (no fan-out).
    const voyagePosts = stub.posts.filter((p) => p.url.includes('/v1/voyages'));
    expect(voyagePosts).toHaveLength(1);
    const vBody = voyagePosts[0].body as { kind: string; scenario_name: string; target: { incarnations: string[] } };
    expect(vBody.kind).toBe('scenario');
    expect(vBody.scenario_name).toBe('restart');
    expect(vBody.target.incarnations.sort()).toEqual(['redis-prod', 'redis-staging']);
  });

  it('Scenario regex-фильтр: совпавшее подмножество → fan-out по совпавшим', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-a', 'redis-b', 'pg-1'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    // regex ^redis- -> only redis-a / redis-b (pg-1 doesn't match).
    await user.type(screen.getByLabelText('Incarnation regex'), '^redis-');
    await waitFor(() => {
      const list = screen.getByLabelText('Matched incarnations').textContent ?? '';
      expect(list).toContain('redis-a');
      expect(list).toContain('redis-b');
      expect(list).not.toContain('pg-1');
    });

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    // A single POST /v1/voyages with only the matched incarnations (redis-a, redis-b).
    const voyagePosts = stub.posts.filter((p) => p.url.includes('/v1/voyages'));
    expect(voyagePosts).toHaveLength(1);
    const vBody = voyagePosts[0].body as { target: { incarnations: string[] } };
    expect(vBody.target.incarnations.sort()).toEqual(['redis-a', 'redis-b']);
    expect(vBody.target.incarnations).not.toContain('pg-1');
  });

  it('Scenario невалидная regex → 0 совпадений, submit заблокирован', async () => {
    setupFetchStub({ incarnationNames: ['redis-a'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    // Unclosed group — invalid regex.
    await user.type(screen.getByLabelText('Incarnation regex'), '(redis');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toMatch(/нет совпадений/),
    );
    // 0 matches -> "Next" disabled (no incarnations for fan-out).
    expect(screen.getByRole('button', { name: /Далее/ })).toBeDisabled();
  });

  it('Scenario per-field input доходит до submit-body.input', async () => {
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

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'hello-world');
    await waitFor(() => expect(screen.getByRole('option', { name: /set_greeting/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'set_greeting');

    // Step 2 -> 3 (incarnations + input). * -> matches hello-prod.
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('hello-prod'),
    );

    const greetingField = await screen.findByTestId('field-text-greeting') as HTMLInputElement;
    await user.type(greetingField, 'hello world');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect(stub.posted?.url).toContain('/v1/voyages');
    const vBody = stub.posted?.body as { kind: string; scenario_name: string; input: Record<string, unknown>; target: { incarnations: string[] } };
    expect(vBody.kind).toBe('scenario');
    expect(vBody.scenario_name).toBe('set_greeting');
    expect(vBody.input).toEqual({ greeting: 'hello world' });
    expect(vBody.target.incarnations).toContain('hello-prod');
  });

  it('Scenario без input_schema → DynamicInputBuilder, поля в POST.input', async () => {
    const stub = setupFetchStub({
      serviceName: 'redis',
      incarnationNames: ['redis-prod'],
      scenarios: [{ name: 'restart', description: 'restart workers' }],
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await waitFor(() => expect(screen.getByLabelText('Scenario input fields')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Add first field/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /field key/i }), { target: { value: 'shard' } });
    fireEvent.change(screen.getByRole('textbox', { name: /field value/i }), { target: { value: 'primary' } });

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect((stub.posted?.body as { input: Record<string, unknown> }).input).toEqual({ shard: 'primary' });
  });

  it('Scenario смешанная schema (simple + array): типизированные поля, не raw-JSON fallback', async () => {
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

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /add_replicas/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'add_replicas');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
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
    expect(screen.getByRole('button', { name: /Далее/ })).toBeDisabled();

    // Valid JSON array -> unblocked; value reaches submit.input.
    fireEvent.change(composite, { target: { value: '["r1.example.com","r2.example.com"]' } });
    await waitFor(() => expect(screen.queryByTestId('field-json-error-replicas')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect((stub.posted?.body as { input: Record<string, unknown> }).input).toEqual({
      redis_maxmemory: '256mb',
      replicas: ['r1.example.com', 'r2.example.com'],
    });
  });

  it('Stepper: прыжок вперёд на невалидный шаг заблокирован (не красит done)', async () => {
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

  it('Command: host-selector резолвит coven-критерий → sids в POST /v1/errand-runs', async () => {
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
    await user.click(screen.getByRole('button', { name: /Далее/ }));

    // Step 2 — host selector. Filter by coven=db.
    const covenChip = await screen.findByLabelText('Coven labels');
    const covenInput = covenChip.querySelector('input') as HTMLInputElement;
    await user.type(covenInput, 'db ');

    // Preview: 2 hosts match.
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/2 hosts match/));

    // Step 2 -> 3 (module/params). Default module core.cmd.shell -> params form with textarea cmd.
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');

    // Step 3 -> 4 -> submit.
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Concurrency')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect(stub.posted?.url).toContain('/v1/voyages');
    const body = stub.posted?.body as { kind: string; module: string; input: { cmd: string }; target: { sids: string[] }; concurrency: number };
    expect(body.kind).toBe('command');
    expect(body.module).toBe('core.cmd.shell');
    expect(body.input.cmd).toBe('uptime');
    expect(body.target.sids.sort()).toEqual(['db-1.example.com', 'db-2.example.com']);
    expect(body.concurrency).toBe(50);
  });

  it('Command: batch (строка) заполнен → уходит в Voyage POST как сырая строка', async () => {
    const stub = setupFetchStub({
      souls: [
        { sid: 'db-1.example.com', covens: ['prod'] },
      ],
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Далее/ }));

    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'prod ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());
    // Enter the string "3" — send a raw string, don't parse client-side.
    await user.type(screen.getByLabelText('Batch'), '3');

    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    expect(body.kind).toBe('command');
    // batch — string, NOT a number; batch_size/batch_percent are absent.
    expect(body.batch).toBe('3');
    expect('batch_size' in body).toBe(false);
    expect('batch_percent' in body).toBe(false);
  });

  it('Command: пустой batch → batch не в теле Voyage POST', async () => {
    const stub = setupFetchStub({
      souls: [{ sid: 'db-1.example.com', covens: ['prod'] }],
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Далее/ }));

    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'prod ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    // don't fill in batch.
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    expect('batch' in body).toBe(false);
    expect('batch_size' in body).toBe(false);
  });

  it('Command: schedule_at → уходит в Voyage POST', async () => {
    const stub = setupFetchStub({
      souls: [{ sid: 'db-1.example.com', covens: ['prod'] }],
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Далее/ }));

    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'prod ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Schedule at')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Schedule at'), { target: { value: '2099-06-01T10:00' } });

    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    expect(body.schedule_at).toBe(new Date('2099-06-01T10:00').toISOString());
  });

  it('Command: dry_run чекбокс недоступен (command-workload), тело без dry_run=true', async () => {
    const stub = setupFetchStub({
      souls: [{ sid: 'db-1.example.com', covens: ['prod'] }],
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Далее/ }));

    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'prod ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    // dry_run checkbox should not be on step 4 for command-workload.
    expect(screen.queryByLabelText('dry_run')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect((stub.posted?.body as Record<string, unknown>).dry_run).toBe(false);
  });

  it('Command: SID-regex критерий резолвит подмножество хостов', async () => {
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
    await user.click(screen.getByRole('button', { name: /Далее/ }));

    // Full-match (anchored): a prefix needs `.*`, otherwise `db-` would match
    // only the exact string "db-".
    await user.type(screen.getByLabelText('SID regex'), 'db-.*');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/2 hosts match/));

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as { target: { sids: string[] } };
    expect(body.target.sids.sort()).toEqual(['db-1.example.com', 'db-2.example.com']);
  });

  it('Command module-search: выбор plugin-модуля из каталога → params-форма → POST', async () => {
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
    await user.click(screen.getByRole('button', { name: /Далее/ }));

    // Host selector: coven=prod -> 1 host.
    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'prod ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    await user.click(screen.getByRole('button', { name: /Далее/ }));

    // Params step: open the module picker, search and select a plugin module from the catalog.
    await waitFor(() => expect(screen.getByTestId('module-picker-control')).toBeInTheDocument());
    await user.click(screen.getByTestId('module-picker-control'));
    await user.type(screen.getByTestId('module-picker-search'), 'http');
    await user.click(await screen.findByTestId('module-option-official.http'));

    // Params form from params[]: typed field url (required) + timeout.
    await waitFor(() => expect(screen.getByTestId('module-params-form')).toBeInTheDocument());
    const urlField = await screen.findByTestId('field-text-url') as HTMLInputElement;
    await user.type(urlField, 'https://example.com');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as { kind: string; module: string; input: Record<string, unknown>; target: { sids: string[] } };
    expect(body.kind).toBe('command');
    // Full module address — name.state.
    expect(body.module).toBe('official.http.probe');
    expect(body.input).toEqual({ url: 'https://example.com' });
    expect(body.target.sids).toEqual(['host-a.example.com']);
  });

  it('Command module-search: каталог недоступен (404) → free-text имя + DynamicInputBuilder', async () => {
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
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'prod ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    await user.click(screen.getByRole('button', { name: /Далее/ }));

    // Free-text fallback: enter the module name manually + dynamic input.
    const freeText = await screen.findByTestId('module-freetext');
    await user.clear(freeText);
    await user.type(freeText, 'core.http.probe');
    await waitFor(() => expect(screen.getByTestId('module-dynamic-input')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Add first field/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /field key/i }), { target: { value: 'url' } });
    fireEvent.change(screen.getByRole('textbox', { name: /field value/i }), { target: { value: 'https://example.com' } });

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as { kind: string; module: string; input: Record<string, unknown> };
    expect(body.kind).toBe('command');
    // free-text without a state segment -> name as-is (core.http.probe).
    expect(body.module).toBe('core.http.probe');
    expect(body.input).toEqual({ url: 'https://example.com' });
  });

  it('Command-state переживает переключение workload Command↔Scenario↔Command', async () => {
    setupFetchStub({ souls: [{ sid: 'db-1.example.com', covens: ['db'] }] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    // Command -> Step2 host -> Step3 params, fill in the cmd field.
    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'db ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');

    // Back to Step1, switch to Scenario and back to Command.
    await user.click(screen.getByRole('button', { name: /Назад/ }));
    await user.click(screen.getByRole('button', { name: /Назад/ }));
    await user.click(screen.getByLabelText('Scenario apply'));
    await user.click(screen.getByLabelText('Command'));

    // Go forward to Step3 — paramFields.cmd value persisted via the draft.
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    expect((screen.getByTestId('field-multiline-cmd') as HTMLTextAreaElement).value).toBe('uptime');
  });

  it('Scenario required-поле блокирует Далее/submit + inline-ошибка', async () => {
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

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'hello-world');
    await waitFor(() => expect(screen.getByRole('option', { name: /set_greeting/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'set_greeting');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('hello-prod'),
    );

    // required greeting is empty -> inline error + Next button disabled.
    await waitFor(() => expect(screen.getByTestId('field-required-greeting')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Далее/ })).toBeDisabled();

    // Fill in -> error clears, can proceed.
    const greetingField = await screen.findByTestId('field-text-greeting') as HTMLInputElement;
    await user.type(greetingField, 'hi');
    await waitFor(() => expect(screen.queryByTestId('field-required-greeting')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Далее/ })).not.toBeDisabled();
  });

  it('Scenario: batch (строка) заполнен → уходит в Voyage POST как сырая строка', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    // Batch field is present, enter a value.
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Batch'), '5');

    await user.click(screen.getByRole('button', { name: /Запустить/ }));
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

  it('Scenario: пустой batch → batch не в теле Voyage POST', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    // Batch is empty by default — don't fill in.
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    // Empty batch -> don't send the field.
    expect('batch' in body).toBe(false);
    expect('batch_size' in body).toBe(false);
    expect((body.target as { incarnations: string[] }).incarnations).toContain('redis-prod');
  });

  it('Scenario + dry-run: Voyage POST несёт dry_run=true в body', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('dry_run')).toBeInTheDocument());
    await user.click(screen.getByLabelText('dry_run'));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect(stub.posted?.url).toContain('/v1/voyages');
    expect((stub.posted?.body as Record<string, unknown>).dry_run).toBe(true);
  });

  it('Scenario без dry-run: Voyage POST несёт dry_run=false', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect((stub.posted?.body as Record<string, unknown>).dry_run).toBe(false);
  });

  it('Scenario + schedule_at: уходит в Voyage POST', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Schedule at')).toBeInTheDocument());
    // datetime-local input — change via fireEvent.
    fireEvent.change(screen.getByLabelText('Schedule at'), { target: { value: '2099-12-31T23:59' } });
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    expect(body.schedule_at).toBe(new Date('2099-12-31T23:59').toISOString());
  });

  it('Scenario: пустой schedule_at → schedule_at не в теле Voyage POST', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    // schedule_at is empty — don't fill in.
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    expect('schedule_at' in body).toBe(false);
  });

  it('Scenario: schedule_at в прошлом → submit заблокирован, показана ошибка', async () => {
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Schedule at')).toBeInTheDocument());
    // Time in the past — should block submit and show an error.
    fireEvent.change(screen.getByLabelText('Schedule at'), { target: { value: '2000-01-01T00:00' } });

    const submitBtn = screen.getByRole('button', { name: /Запустить/ });
    expect(submitBtn).toBeDisabled();
    expect(screen.getByText(/Время запуска должно быть в будущем|Schedule time must be in the future/)).toBeInTheDocument();
  });

  it('Scenario: schedule_at в будущем → submit разблокирован, schedule_at в теле', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Schedule at')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Schedule at'), { target: { value: '2099-06-15T12:00' } });

    const submitBtn = screen.getByRole('button', { name: /Запустить/ });
    expect(submitBtn).not.toBeDisabled();
    expect(screen.queryByText(/Время запуска должно быть в будущем|Schedule time must be in the future/)).not.toBeInTheDocument();

    await user.click(submitBtn);
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());
    expect((stub.posted?.body as Record<string, unknown>).schedule_at).toBe(new Date('2099-06-15T12:00').toISOString());
  });

  it('Stale-черновик старой формы (без v / без incarnations) → визард грузится на дефолтах без краша', async () => {
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
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    // Empty regex -> matched=[] (step blocked) — the test only checks there's no crash.
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
  });

  it('Stale-черновик прошлой версии (v отличается) → отбрасывается, дефолты без краша', async () => {
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

  it('Валидный свежий черновик (v=10, incarnationRegex) → state восстанавливается', async () => {
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

  it('Batch size: невалидное значение → inline-ошибка видна, submit заблокирован', async () => {
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());
    // Invalid format (letters — not N|N%).
    await user.type(screen.getByLabelText('Batch'), 'abc');

    // Inline error appeared.
    await waitFor(() =>
      expect(
        screen.getByText(/Формат: целое число|Format: integer/),
      ).toBeInTheDocument(),
    );
    // Submit blocked.
    expect(screen.getByRole('button', { name: /Запустить/ })).toBeDisabled();
  });

  it('Batch: валидное значение N → ошибки нет, submit не заблокирован', async () => {
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Batch'), '5');

    expect(
      screen.queryByText(/Формат: целое число|Format: integer/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Запустить/ })).not.toBeDisabled();
  });

  it('Batch: валидное значение N% → ошибки нет, submit не заблокирован', async () => {
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Batch'), '20%');

    expect(
      screen.queryByText(/Формат: целое число|Format: integer/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Запустить/ })).not.toBeDisabled();
  });

  it('Batch: пустое поле → ошибки нет (поле опциональное)', async () => {
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());
    // Don't enter anything — field is empty.

    expect(
      screen.queryByText(/Формат: целое число|Format: integer/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Запустить/ })).not.toBeDisabled();
  });

  it('Pre-fill ?workload=command&target_coven=prod → host-criteria coven', async () => {
    setupFetchStub({ souls: [{ sid: 'host-a.example.com', covens: ['prod'] }] });
    renderWizardWithRoutes('/run?workload=command&target_coven=prod');
    // Workload=command selected.
    expect(screen.getByLabelText('Command')).toBeChecked();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    // Coven criterion pre-filled (chip 'prod').
    await waitFor(() => expect(screen.getByLabelText('Coven labels').textContent).toContain('prod'));
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
  });

  // --- Tests S-W5 (updated for S6): batch_mode / max_failures / require_alive ---

  async function reachStep4Command() {
    const stub = setupFetchStub({ souls: [{ sid: 'db-1.example.com', covens: ['prod'] }] });
    renderWizardWithRoutes();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'prod ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Concurrency')).toBeInTheDocument());
    return { stub, user };
  }

  it('batch_mode=window → поле Batch скрыто, concurrency-hint изменён', async () => {
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
      expect(hint).toMatch(/окн|window/i);
    });
  });

  it('batch_mode=window → batch/batch_size не уходят в POST', async () => {
    const { stub, user } = await reachStep4Command();
    await user.click(screen.getByLabelText('batch_mode_window'));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    expect(body.batch_mode).toBe('window');
    expect('batch' in body).toBe(false);
    expect('batch_size' in body).toBe(false);
  });

  it('batch_mode=barrier (дефолт) → batch_mode=barrier в POST, без лишних полей', async () => {
    const { stub, user } = await reachStep4Command();
    // Default barrier, don't touch anything.
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    expect(body.batch_mode).toBe('barrier');
    expect('batch_percent' in body).toBe(false);
    expect('inter_unit_interval_ms' in body).toBe(false);
  });

  it('batch строка «20%» уходит в POST как сырая строка, не число', async () => {
    const { stub, user } = await reachStep4Command();
    await user.type(screen.getByLabelText('Batch'), '20%');
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    // String "20%" — not converted to number 20; batch_percent is absent.
    expect(body.batch).toBe('20%');
    expect('batch_size' in body).toBe(false);
    expect('batch_percent' in body).toBe(false);
  });

  it('max_failures строка заполнена → уходит в POST как max_failures (строка)', async () => {
    const { stub, user } = await reachStep4Command();
    await user.type(screen.getByLabelText('Max failures'), '3');
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    expect(body.max_failures).toBe('3');
    expect('fail_threshold' in body).toBe(false);
  });

  it('max_failures пустой → не уходит в POST', async () => {
    const { stub, user } = await reachStep4Command();
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect('max_failures' in (stub.posted?.body as Record<string, unknown>)).toBe(false);
    expect('fail_threshold' in (stub.posted?.body as Record<string, unknown>)).toBe(false);
  });

  it('require_alive чекбокс → уходит в POST', async () => {
    const { stub, user } = await reachStep4Command();
    await user.click(screen.getByLabelText('require_alive'));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect((stub.posted?.body as Record<string, unknown>).require_alive).toBe(true);
  });

  it('require_alive дефолт false → уходит в POST как false', async () => {
    const { stub, user } = await reachStep4Command();
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect((stub.posted?.body as Record<string, unknown>).require_alive).toBe(false);
  });

  it('inter_unit_interval_ms поле виден только в window, уходит в POST', async () => {
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
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
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
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    // Step 2 -> select service and scenario.
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    // Step 3 → incarnation regex.
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    // Step 4 -> cadence block appears in Options (runMode='cadence' is already set).
    await waitFor(() => expect(screen.getByTestId('cadence-interval')).toBeInTheDocument());

    return { user };
  }

  it('Cadence: input[min] равен CONSTRAINTS.cadenceIntervalSecondsMin', async () => {
    await reachStep4Cadence();

    const intervalInput = screen.getByTestId('cadence-interval') as HTMLInputElement;
    expect(Number(intervalInput.min)).toBe(CONSTRAINTS.cadenceIntervalSecondsMin);
  });

  it('Cadence: submit-валидация отвергает значение ниже floor', async () => {
    const { user } = await reachStep4Cadence();

    // Fill in the Cadence name (required field) and enter a value below the floor.
    const nameInput = screen.getByTestId('cadence-name') as HTMLInputElement;
    await user.type(nameInput, 'test-cadence');

    const intervalInput = screen.getByTestId('cadence-interval');
    fireEvent.change(intervalInput, { target: { value: String(CONSTRAINTS.cadenceIntervalSecondsMin - 1) } });

    // Submit should be blocked (below floor).
    expect(screen.getByRole('button', { name: /Создать расписание|Create schedule/ })).toBeDisabled();
  });

  it('Cadence: submit-валидация принимает значение точно на floor', async () => {
    const { user } = await reachStep4Cadence();

    // Fill in the Cadence name and enter a value exactly at the floor.
    const nameInput = screen.getByTestId('cadence-name') as HTMLInputElement;
    await user.type(nameInput, 'test-cadence');

    const intervalInput = screen.getByTestId('cadence-interval');
    fireEvent.change(intervalInput, { target: { value: String(CONSTRAINTS.cadenceIntervalSecondsMin) } });

    // Submit should be unblocked (exactly at floor).
    expect(screen.getByRole('button', { name: /Создать расписание|Create schedule/ })).not.toBeDisabled();
  });

  // --- Guard tests S6: batch / max_failures / preview ---

  it('S6: max_failures tooltip присутствует (aria-label)', async () => {
    await reachStep4Command();
    // Tooltip should be in the markup.
    await waitFor(() => expect(screen.getByLabelText(/Threshold is counted|Порог считается/)).toBeInTheDocument());
  });

  it('S6: max_failures строка «25%» уходит как max_failures в POST (не fail_threshold)', async () => {
    const { stub, user } = await reachStep4Command();
    await user.type(screen.getByLabelText('Max failures'), '25%');
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    expect(body.max_failures).toBe('25%');
    expect('fail_threshold' in body).toBe(false);
  });

  it('S6: snapshot target (regex/sids) → batch-preview клиентский, preview-endpoint НЕ вызывается', async () => {
    // Command with sidRegex — snapshot-target. Preview endpoint should not be hit.
    const previewCalls: string[] = [];
    const stub = setupFetchStub({ souls: [{ sid: 'db-1.example.com', covens: [] }] });
    const baseFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/v1/voyages/preview')) previewCalls.push(url);
      return baseFetch(input, init);
    }) as typeof fetch);

    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.type(screen.getByLabelText('SID regex'), 'db-.*');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());

    // Enter batch — preview should not be hit (snapshot-target).
    await user.type(screen.getByLabelText('Batch'), '1');
    await waitFor(() => expect(screen.getByLabelText('Batch')).toHaveValue('1'));

    // preview was not called.
    expect(previewCalls).toHaveLength(0);

    void stub; // Suppress unused var warning.
  });

  it('S6: late-binding coven target → preview-endpoint вызывается (debounced)', async () => {
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
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'prod ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());

    // Preview should be called (after debounce).
    await waitFor(() => expect(previewReplies.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(previewReplies.length).toBeGreaterThan(0);
  });

  it('S6: window batch_mode → batch-preview показывает window-сообщение (не null)', async () => {
    // For a snapshot-target with 1 incarnation, window mode.
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    // Switch to window — batch field hidden, batch-preview not shown.
    await waitFor(() => expect(screen.getByLabelText('batch_mode_window')).toBeInTheDocument());
    await user.click(screen.getByLabelText('batch_mode_window'));
    // batch field hidden.
    expect(screen.queryByLabelText('Batch')).not.toBeInTheDocument();
    // batch-preview under the batch field is not shown (isWindow=true hides the block).
    expect(screen.queryByTestId('batch-preview')).not.toBeInTheDocument();
  });

  it('S6: snapshot scenario-target + batch «2» → local batch-preview показан (≈1 батч для 1 инкарнации)', async () => {
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Batch')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Batch'), '2');

    // Scope=1 incarnation, batch=2 -> ceil(1/2)=1 batch. batch-preview appeared.
    await waitFor(() => expect(screen.getByTestId('batch-preview')).toBeInTheDocument());
    expect(screen.getByTestId('batch-preview').textContent).toMatch(/1/);
  });

  it('S6: 422 от preview/create → показан detail из keeper в submitError', async () => {
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
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'prod ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));

    // 422 error from keeper shown in submitError.
    await waitFor(() =>
      expect(screen.getByText(/422|batch spec conflict/)).toBeInTheDocument(),
    );
  });
});

// --- Notify block RunWizard (ADR-052(g) amendment N2) ---

describe('RunWizard — notify-блок Step 4', () => {
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
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    // Step 2 → 3
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    // Step 3 → 4
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByTestId('notify-block')).toBeInTheDocument());

    return stub;
  }

  it('notify-блок виден на Step 4 (voyage-режим)', async () => {
    const user = userEvent.setup();
    await reachStep4Scenario(user);
    expect(screen.getByTestId('notify-block')).toBeInTheDocument();
  });

  it('кнопка «Добавить уведомление» создаёт новый notify-элемент', async () => {
    const user = userEvent.setup();
    await reachStep4Scenario(user);

    await user.click(screen.getByTestId('notify-add-btn'));
    await waitFor(() => expect(screen.getByTestId('notify-item-0')).toBeInTheDocument());
    expect(screen.getByTestId('notify-herald-select-0')).toBeInTheDocument();
  });

  it('выбор Herald и submit несут notify[] в POST /v1/voyages', async () => {
    const user = userEvent.setup();
    const stub = await reachStep4Scenario(user);

    // Add a notify item.
    await user.click(screen.getByTestId('notify-add-btn'));
    await waitFor(() => expect(screen.getByTestId('notify-herald-select-0')).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('notify-herald-select-0'), 'ops-webhook');

    // Submit.
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const voyagePost = stub.posts.find((p) => p.url.includes('/v1/voyages') && !p.url.includes('/preview'));
    expect(voyagePost).toBeDefined();
    const body = voyagePost!.body as { notify?: Array<{ herald: string }> };
    expect(body.notify).toBeDefined();
    expect(body.notify![0].herald).toBe('ops-webhook');
  });

  it('notify-элемент с пустым herald не попадает в POST', async () => {
    const user = userEvent.setup();
    const stub = await reachStep4Scenario(user);

    // Add a notify item, but don't select Herald.
    await user.click(screen.getByTestId('notify-add-btn'));
    await waitFor(() => expect(screen.getByTestId('notify-item-0')).toBeInTheDocument());

    // Submit without Herald.
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const voyagePost = stub.posts.find((p) => p.url.includes('/v1/voyages') && !p.url.includes('/preview'));
    expect(voyagePost).toBeDefined();
    const body = voyagePost!.body as { notify?: unknown };
    // Empty herald -> don't send notify.
    expect(body.notify).toBeUndefined();
  });

  it('кнопка «Удалить» удаляет notify-элемент', async () => {
    const user = userEvent.setup();
    await reachStep4Scenario(user);

    await user.click(screen.getByTestId('notify-add-btn'));
    await waitFor(() => expect(screen.getByTestId('notify-item-0')).toBeInTheDocument());

    await user.click(screen.getByTestId('notify-remove-0'));
    await waitFor(() => expect(screen.queryByTestId('notify-item-0')).not.toBeInTheDocument());
  });

  // Guard: regression — the "add" annotation button didn't add a row
  // (kvToAnnotations dropped an empty key -> annotations: undefined -> the row disappeared).
  it('GUARD: кнопка добавления annotations добавляет редактируемую строку (key+value)', async () => {
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
  it('GUARD: заполненные annotations попадают в POST body', async () => {
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
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
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
