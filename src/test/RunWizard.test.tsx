import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { RunWizard } from '../pages/run/RunWizard';
import { tokenStore } from '../api/tokenStore';

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
  params?: Array<{ name: string; type?: string; required?: boolean; secret?: boolean; description?: string }>;
}
interface FetchStubOpts {
  serviceName?: string;
  scenarios?: ScenarioStubEntry[];
  incarnationNames?: string[];
  souls?: SoulStub[];
  // soulprint typed_facts по SID (для soulprint-фильтра).
  soulprints?: Record<string, unknown>;
  // Каталог модулей (GET /v1/modules). undefined → дефолтные core cmd/exec.
  modules?: ModuleStub[];
}

const DEFAULT_MODULES: ModuleStub[] = [
  { name: 'core.cmd', kind: 'core', description: 'shell command', states: ['shell'], errand_safe: true, params: [] },
  { name: 'core.exec', kind: 'core', description: 'binary + args', states: ['run'], errand_safe: true, params: [] },
];

interface CapturedPost {
  url: string;
  body: unknown;
}

// Универсальный fetch-stub: накапливает ВСЕ POST в `posts` (для fan-out проверки),
// `posted` — последний. GET-ы возвращают services/scenarios/incarnations/souls/soulprint.
function setupFetchStub(opts: FetchStubOpts = {}): { posted: CapturedPost | null; posts: CapturedPost[] } {
  const serviceName = opts.serviceName ?? 'redis';
  const scenarios: ScenarioStubEntry[] = opts.scenarios ?? [
    { name: 'create', description: 'init', input_schema: {} },
    { name: 'restart', description: 'restart workers', input_schema: {} },
  ];
  const incarnationNames = opts.incarnationNames ?? ['redis-prod'];
  const souls: SoulStub[] = opts.souls ?? [];
  const soulprints = opts.soulprints ?? {};
  const modules = opts.modules ?? DEFAULT_MODULES;
  const ref: { posted: CapturedPost | null; posts: CapturedPost[] } = { posted: null, posts: [] };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(init.body as string) : null;
    const json = (obj: unknown, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

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
  }) as typeof fetch;
  return ref;
}

describe('RunWizard', () => {
  beforeEach(() => {
    tokenStore.clear();
    sessionStorage.clear();
    // @ts-expect-error — EventSource нет в jsdom, минимальный stub.
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

    // Step 1 → 2 (scenario select).
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    // Step 2 → 3. Regex пуст.
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());

    // Пустая regex → matched=[], «Далее» disabled, подсказка видна.
    expect(screen.getByLabelText('Incarnation regex')).toHaveValue('');
    expect(screen.getByRole('button', { name: /Далее/ })).toBeDisabled();
    // Подсказка "укажите regex или * для всех" должна присутствовать на экране.
    await waitFor(() => expect(screen.getByText(/укажите regex или \* для всех/)).toBeInTheDocument());
  });

  it('Scenario: regex * → все incarnations → submit', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-prod', 'redis-staging'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    // Step 1 → 2 (scenario select).
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    // Step 2 → 3. Вводим * → совпадают ВСЕ incarnations.
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() => {
      const list = screen.getByLabelText('Matched incarnations').textContent ?? '';
      expect(list).toContain('redis-prod');
      expect(list).toContain('redis-staging');
    });
    expect(screen.getByRole('button', { name: /Далее/ })).not.toBeDisabled();

    // Step 3 → 4 → submit → POST /v1/voyages с incarnations=[redis-prod, redis-staging].
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    // Один POST на /v1/voyages (не fan-out).
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
    // regex ^redis- → только redis-a / redis-b (pg-1 не совпадает).
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

    // Один POST /v1/voyages с только совпавшими incarnations (redis-a, redis-b).
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
    // Незакрытая группа — невалидная regex.
    await user.type(screen.getByLabelText('Incarnation regex'), '(redis');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toMatch(/нет совпадений/),
    );
    // 0 совпадений → «Далее» disabled (нет incarnations для fan-out).
    expect(screen.getByRole('button', { name: /Далее/ })).toBeDisabled();
  });

  it('Scenario per-field input доходит до submit-body.input', async () => {
    const stub = setupFetchStub({
      serviceName: 'hello-world',
      incarnationNames: ['hello-prod'],
      scenarios: [
        {
          name: 'set_greeting',
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

    // Step 2 → 3 (incarnations + input). * → совпадает hello-prod.
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('hello-prod'),
    );

    const greetingLabel = await screen.findByText(/^greeting \*?$/);
    const greetingField = greetingLabel.parentElement?.querySelector('input') as HTMLInputElement;
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
    // Регрессия: раньше один составной тип (array/object) ронял ВСЮ форму в
    // DynamicInputBuilder, пряча простые типизированные поля. Теперь — per-field.
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

    // Простое поле — типизированный input (НЕ raw-JSON-textarea формы).
    await waitFor(() => expect(screen.getByText(/^redis_maxmemory$/)).toBeInTheDocument());
    // Составное поле — per-field JSON-textarea.
    const composite = screen.getByTestId('field-composite-replicas') as HTMLTextAreaElement;
    expect(composite).toBeInTheDocument();
    // НЕ деградировали в общий DynamicInputBuilder.
    expect(screen.queryByLabelText('Scenario input fields')).not.toBeInTheDocument();

    // Невалидный JSON в составном поле → submit заблокирован + inline-ошибка.
    fireEvent.change(composite, { target: { value: '[broken' } });
    await waitFor(() => expect(screen.getByTestId('field-json-error-replicas')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Далее/ })).toBeDisabled();

    // Валидный JSON-массив → разблокировка; значение доходит до submit.input.
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

    // На Step 1 шаги 2/3/4 ещё недостижимы (scenario не выбран) → их кнопки disabled.
    const stepButtons = screen.getByLabelText('Wizard steps').querySelectorAll('button');
    // [0]=Step1 (текущий), [1]=Step2, [2]=Step3, [3]=Step4.
    expect(stepButtons[3]).toBeDisabled();
    expect(stepButtons[2]).toBeDisabled();

    // Клик по «4» не переводит на Step 4 (остаёмся на Step 1).
    await user.click(stepButtons[3]);
    expect(screen.getByLabelText('Scenario apply')).toBeInTheDocument();
    // Ни один шаг не помечен done (stepDone) — белым ничего не подсветилось.
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

    // Step 2 — host selector. Фильтруем по coven=db.
    const covenChip = await screen.findByLabelText('Coven labels');
    const covenInput = covenChip.querySelector('input') as HTMLInputElement;
    await user.type(covenInput, 'db ');

    // Preview: 2 hosts match.
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/2 hosts match/));

    // Step 2 → 3 (module/params). Дефолтный модуль core.cmd.shell → cmd-textarea.
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Command')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Command'), 'uptime');

    // Step 3 → 4 → submit.
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

  it('Command: batch_size заполнен → уходит в Voyage POST', async () => {
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
    await waitFor(() => expect(screen.getByLabelText('Command')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Command'), 'uptime');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Batch size')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Batch size'), '3');

    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    expect(body.kind).toBe('command');
    expect(body.batch_size).toBe(3);
  });

  it('Command: пустой batch_size → batch_size не в теле Voyage POST', async () => {
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
    await waitFor(() => expect(screen.getByLabelText('Command')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Command'), 'uptime');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    // batch_size не заполняем.
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
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
    await waitFor(() => expect(screen.getByLabelText('Command')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Command'), 'uptime');

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
    await waitFor(() => expect(screen.getByLabelText('Command')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Command'), 'uptime');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    // dry_run чекбокс не должен быть на шаге 4 для command-workload.
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

    // Full-match (anchored): для префикса нужен `.*`, иначе `db-` совпало бы
    // только с точной строкой «db-».
    await user.type(screen.getByLabelText('SID regex'), 'db-.*');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/2 hosts match/));

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.type(screen.getByLabelText('Command'), 'uptime');
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

    // Host selector: coven=prod → 1 host.
    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'prod ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    await user.click(screen.getByRole('button', { name: /Далее/ }));

    // Params step: открываем module-picker, ищем и выбираем plugin-модуль из каталога.
    await waitFor(() => expect(screen.getByTestId('module-picker-control')).toBeInTheDocument());
    await user.click(screen.getByTestId('module-picker-control'));
    await user.type(screen.getByTestId('module-picker-search'), 'http');
    await user.click(await screen.findByTestId('module-option-official.http'));

    // Params-форма по params[]: типизированное поле url (required) + timeout.
    await waitFor(() => expect(screen.getByTestId('module-params-form')).toBeInTheDocument());
    const urlLabel = await screen.findByText(/^url \*?$/);
    const urlField = urlLabel.parentElement?.querySelector('input') as HTMLInputElement;
    await user.type(urlField, 'https://example.com');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as { kind: string; module: string; input: Record<string, unknown>; target: { sids: string[] } };
    expect(body.kind).toBe('command');
    // Полный адрес модуля — name.state.
    expect(body.module).toBe('official.http.probe');
    expect(body.input).toEqual({ url: 'https://example.com' });
    expect(body.target.sids).toEqual(['host-a.example.com']);
  });

  it('Command module-search: каталог недоступен (404) → free-text имя + DynamicInputBuilder', async () => {
    const stub = setupFetchStub({
      souls: [{ sid: 'host-a.example.com', covens: ['prod'] }],
      modules: [], // list вернёт {items:[]}; для 404 подменим ниже
    });
    // Переопределяем /v1/modules на 404 (graceful-fallback path).
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/v1/modules')) {
        return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      return prevFetch(input, init);
    }) as typeof fetch;

    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'prod ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    await user.click(screen.getByRole('button', { name: /Далее/ }));

    // Free-text fallback: вводим имя модуля вручную + dynamic input.
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
    // free-text без state-сегмента → имя как есть (core.http.probe).
    expect(body.module).toBe('core.http.probe');
    expect(body.input).toEqual({ url: 'https://example.com' });
  });

  it('Command-state переживает переключение workload Command↔Scenario↔Command', async () => {
    setupFetchStub({ souls: [{ sid: 'db-1.example.com', covens: ['db'] }] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    // Command → Step2 host → Step3 params, заполняем cmd.
    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    const covenChip = await screen.findByLabelText('Coven labels');
    await user.type(covenChip.querySelector('input') as HTMLInputElement, 'db ');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.type(screen.getByLabelText('Command'), 'uptime');

    // Назад на Step1, переключаемся на Scenario и обратно на Command.
    await user.click(screen.getByRole('button', { name: /Назад/ }));
    await user.click(screen.getByRole('button', { name: /Назад/ }));
    await user.click(screen.getByLabelText('Scenario apply'));
    await user.click(screen.getByLabelText('Command'));

    // Идём вперёд до Step3 — cmd сохранился.
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    expect((screen.getByLabelText('Command') as HTMLTextAreaElement).value).toBe('uptime');
  });

  it('Scenario required-поле блокирует Далее/submit + inline-ошибка', async () => {
    setupFetchStub({
      serviceName: 'hello-world',
      incarnationNames: ['hello-prod'],
      scenarios: [
        {
          name: 'set_greeting',
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

    // required greeting пустой → inline-ошибка + кнопка Далее disabled.
    await waitFor(() => expect(screen.getByTestId('field-required-greeting')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Далее/ })).toBeDisabled();

    // Заполняем → ошибка уходит, можно дальше.
    const greetingLabel = await screen.findByText(/^greeting \*?$/);
    const greetingField = greetingLabel.parentElement?.querySelector('input') as HTMLInputElement;
    await user.type(greetingField, 'hi');
    await waitFor(() => expect(screen.queryByTestId('field-required-greeting')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Далее/ })).not.toBeDisabled();
  });

  it('Scenario: batch_size заполнен → уходит в Voyage POST', async () => {
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
    // Поле Batch size присутствует, вводим значение.
    await waitFor(() => expect(screen.getByLabelText('Batch size')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Batch size'), '5');

    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    expect(stub.posted?.url).toContain('/v1/voyages');
    const body = stub.posted?.body as {
      kind: string;
      scenario_name: string;
      batch_size?: number;
      on_failure?: string;
      concurrency?: number;
      target: { incarnations: string[] };
    };
    expect(body.kind).toBe('scenario');
    expect(body.scenario_name).toBe('restart');
    expect(body.batch_size).toBe(5);
    expect(body.on_failure).toBe('abort');
    expect(body.concurrency).toBe(50);
    expect(body.target.incarnations).toContain('redis-prod');
  });

  it('Scenario: пустой batch_size → batch_size не в теле Voyage POST', async () => {
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

    // Batch size пуст по умолчанию — не заполняем.
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Batch size')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const body = stub.posted?.body as Record<string, unknown>;
    // Пустой batch_size → не шлём поле.
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
    // datetime-local input — меняем через fireEvent.
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
    // schedule_at пуст — не заполняем.
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
    // Время в прошлом — должно заблокировать submit и показать ошибку.
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
    // Черновик предыдущей версии формы: нет поля `v`, scenarioState без
    // `incarnations` (массив добавлен недавно), options без Tide-полей.
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

    // Не упали белым экраном: Step 1 отрендерился, дефолт workload=scenario.
    expect(screen.getByLabelText('Scenario apply')).toBeChecked();

    // Дефолты применились — проходим визард с нуля без ошибок.
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    // Пустая regex → matched=[] (шаг заблокирован) — тест только проверяет отсутствие краша.
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
  });

  it('Stale-черновик прошлой версии (v отличается) → отбрасывается, дефолты без краша', async () => {
    setupFetchStub({ incarnationNames: ['redis-prod'] });
    // Прошлая версия формы (v=3, scenarioState без incarnationRegex). loadDraft
    // отбрасывает по несовпадению версии → визард стартует с дефолтов, без краша.
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
    // Версия не совпала → стартуем на Step 1 с дефолтным workload=scenario.
    expect(screen.getByLabelText('Scenario apply')).toBeChecked();
  });

  it('Валидный свежий черновик (v=5, incarnationRegex) → state восстанавливается', async () => {
    setupFetchStub({ incarnationNames: ['redis-prod', 'redis-staging'] });
    sessionStorage.setItem(
      'run-wizard-draft',
      JSON.stringify({
        v: 5,
        step: 3,
        workload: 'scenario',
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
          cmd: '',
          paramFields: {},
          timeoutSeconds: 30,
          customModule: '',
          customInput: {},
        },
        hostCriteria: { incarnations: [], covens: [], sidRegex: '', soulprint: '' },
        options: {
          batchSize: '',
          concurrency: '50',
          onFailure: 'abort',
          dryRun: false,
          wait: false,
          scheduleAt: '',
        },
      }),
    );

    renderWizardWithRoutes();
    // Восстановлен на Step 3; regex сохранён → матчится только redis-prod (не staging).
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
    await waitFor(() => expect(screen.getByLabelText('Batch size')).toBeInTheDocument());
    // Невалидное значение (не целое).
    await user.type(screen.getByLabelText('Batch size'), '0');

    // Inline-ошибка появилась.
    await waitFor(() =>
      expect(
        screen.getByText(/Размер батча — целое число от 1 до 10000|Batch size must be an integer between 1 and 10000/),
      ).toBeInTheDocument(),
    );
    // Submit заблокирован.
    expect(screen.getByRole('button', { name: /Запустить/ })).toBeDisabled();
  });

  it('Batch size: валидное значение → ошибки нет, submit не заблокирован', async () => {
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
    await waitFor(() => expect(screen.getByLabelText('Batch size')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Batch size'), '5');

    expect(
      screen.queryByText(/Размер батча — целое число от 1 до 10000|Batch size must be an integer between 1 and 10000/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Запустить/ })).not.toBeDisabled();
  });

  it('Batch size: пустое поле → ошибки нет (поле опциональное)', async () => {
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
    await waitFor(() => expect(screen.getByLabelText('Batch size')).toBeInTheDocument());
    // Не вводим ничего — поле пустое.

    expect(
      screen.queryByText(/Размер батча — целое число от 1 до 10000|Batch size must be an integer between 1 and 10000/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Запустить/ })).not.toBeDisabled();
  });

  it('Batch size: выше верхней границы (10001) → inline-ошибка видна, submit заблокирован', async () => {
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
    await waitFor(() => expect(screen.getByLabelText('Batch size')).toBeInTheDocument());
    // Выше верхней границы (10000 = max_scope-дефолт backend).
    await user.type(screen.getByLabelText('Batch size'), '10001');

    await waitFor(() =>
      expect(
        screen.getByText(/Размер батча — целое число от 1 до 10000|Batch size must be an integer between 1 and 10000/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /Запустить/ })).toBeDisabled();
  });

  it('Pre-fill ?workload=command&target_coven=prod → host-criteria coven', async () => {
    setupFetchStub({ souls: [{ sid: 'host-a.example.com', covens: ['prod'] }] });
    renderWizardWithRoutes('/run?workload=command&target_coven=prod');
    // Workload=command выбран.
    expect(screen.getByLabelText('Command')).toBeChecked();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    // Coven-критерий pre-filled (chip 'prod').
    await waitFor(() => expect(screen.getByLabelText('Coven labels').textContent).toContain('prod'));
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/1 hosts match/));
  });
});
