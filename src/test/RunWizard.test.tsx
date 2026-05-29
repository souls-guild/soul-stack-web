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
      <Route path="/errand-runs/:id" element={<div data-testid="errand-run-detail" />} />
      <Route path="/incarnations" element={<div data-testid="incarnations-list" />} />
      <Route path="/incarnations/:name" element={<div data-testid="incarnation-detail" />} />
      <Route path="/tides/:id" element={<div data-testid="tide-detail" />} />
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
interface FetchStubOpts {
  serviceName?: string;
  scenarios?: ScenarioStubEntry[];
  incarnationNames?: string[];
  souls?: SoulStub[];
  // soulprint typed_facts по SID (для soulprint-фильтра).
  soulprints?: Record<string, unknown>;
}

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
  const ref: { posted: CapturedPost | null; posts: CapturedPost[] } = { posted: null, posts: [] };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(init.body as string) : null;
    const json = (obj: unknown, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

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

  it('Scenario: service → scenario → multi-select incarnations → submit', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-prod'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    // Step 1 → 2 (scenario select).
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    // Step 2 → 3 (incarnations).
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('redis-prod')).toBeInTheDocument());
    await user.click(screen.getByLabelText('redis-prod'));

    // Step 3 → 4 → submit.
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('incarnation-detail')).toBeInTheDocument());

    expect(stub.posted?.url).toMatch(/\/v1\/incarnations\/redis-prod\/scenarios\/restart$/);
    expect((stub.posted?.body as { input: Record<string, unknown> }).input).toEqual({});
  });

  it('Scenario multi-incarnation fan-out: POST на каждую incarnation, redirect /incarnations', async () => {
    const stub = setupFetchStub({ incarnationNames: ['redis-a', 'redis-b'] });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('redis-a')).toBeInTheDocument());
    await user.click(screen.getByLabelText('redis-a'));
    await user.click(screen.getByLabelText('redis-b'));

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('incarnations-list')).toBeInTheDocument());

    const scenarioPosts = stub.posts.filter((p) => /\/scenarios\//.test(p.url));
    expect(scenarioPosts).toHaveLength(2);
    expect(scenarioPosts.map((p) => p.url).some((u) => /redis-a\/scenarios\/restart$/.test(u))).toBe(true);
    expect(scenarioPosts.map((p) => p.url).some((u) => /redis-b\/scenarios\/restart$/.test(u))).toBe(true);
  });

  it('Scenario per-field input доходит до submit-body.input', async () => {
    const stub = setupFetchStub({
      serviceName: 'hello-world',
      incarnationNames: ['hello-prod'],
      scenarios: [
        {
          name: 'create',
          description: 'create hello',
          input_schema: { greeting: { type: 'string', required: true, description: 'greet text' } },
        },
      ],
    });
    renderWizardWithRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'hello-world');
    await waitFor(() => expect(screen.getByRole('option', { name: /create/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'create');

    // Step 2 → 3 (incarnations + input).
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('hello-prod')).toBeInTheDocument());
    await user.click(screen.getByLabelText('hello-prod'));

    const greetingLabel = await screen.findByText(/^greeting \*?$/);
    const greetingField = greetingLabel.parentElement?.querySelector('input') as HTMLInputElement;
    await user.type(greetingField, 'hello world');

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('incarnation-detail')).toBeInTheDocument());

    expect(stub.posted?.url).toMatch(/\/v1\/incarnations\/hello-prod\/scenarios\/create$/);
    expect((stub.posted?.body as { input: Record<string, unknown> }).input).toEqual({ greeting: 'hello world' });
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
    await waitFor(() => expect(screen.getByLabelText('redis-prod')).toBeInTheDocument());
    await user.click(screen.getByLabelText('redis-prod'));

    await waitFor(() => expect(screen.getByLabelText('Scenario input fields')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Add first field/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /field key/i }), { target: { value: 'shard' } });
    fireEvent.change(screen.getByRole('textbox', { name: /field value/i }), { target: { value: 'primary' } });

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('incarnation-detail')).toBeInTheDocument());

    expect((stub.posted?.body as { input: Record<string, unknown> }).input).toEqual({ shard: 'primary' });
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

    // Step 2 → 3 (module/params).
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Module')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Command'), 'uptime');

    // Step 3 → 4 → submit.
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Concurrency')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('errand-run-detail')).toBeInTheDocument());

    expect(stub.posted?.url).toContain('/v1/errand-runs');
    const body = stub.posted?.body as { module: string; input: { cmd: string }; target: { sids: string[] }; concurrency: number };
    expect(body.module).toBe('core.cmd.shell');
    expect(body.input.cmd).toBe('uptime');
    expect(body.target.sids.sort()).toEqual(['db-1.example.com', 'db-2.example.com']);
    expect(body.concurrency).toBe(50);
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

    await user.type(screen.getByLabelText('SID regex'), '^db-');
    await waitFor(() => expect(screen.getByLabelText('Host preview').textContent).toMatch(/2 hosts match/));

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.type(screen.getByLabelText('Command'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('errand-run-detail')).toBeInTheDocument());

    const body = stub.posted?.body as { target: { sids: string[] } };
    expect(body.target.sids.sort()).toEqual(['db-1.example.com', 'db-2.example.com']);
  });

  it('Command custom-module → DynamicInputBuilder + sids в POST', async () => {
    const stub = setupFetchStub({
      souls: [{ sid: 'host-a.example.com', covens: ['prod'] }],
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

    // Params: custom module.
    await waitFor(() => expect(screen.getByLabelText('Module')).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Module'), 'custom');
    await user.type(screen.getByLabelText('Custom module name'), 'core.http.probe');
    await waitFor(() => expect(screen.getByLabelText('Custom module input fields')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Add first field/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /field key/i }), { target: { value: 'url' } });
    fireEvent.change(screen.getByRole('textbox', { name: /field value/i }), { target: { value: 'https://example.com' } });

    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('errand-run-detail')).toBeInTheDocument());

    const body = stub.posted?.body as { module: string; input: Record<string, unknown>; target: { sids: string[] } };
    expect(body.module).toBe('core.http.probe');
    expect(body.input).toEqual({ url: 'https://example.com' });
    expect(body.target.sids).toEqual(['host-a.example.com']);
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
