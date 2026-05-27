import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
      <Route path="/incarnations/:name" element={<div data-testid="incarnation-detail" />} />
      <Route path="/tides/:id" element={<div data-testid="tide-detail" />} />
      <Route path="/push-runs/:applyId" element={<div data-testid="push-run-detail" />} />
    </Routes>,
    { wrapper: Wrap },
  );
}

// Универсальный fetch-stub: пишет последний POST-body в `posted`, возвращает success
// для известных POST-эндпоинтов и пустой list для GET-ов (souls/services/incarnations).
function setupFetchStub(): { posted: { url: string; body: unknown } | null } {
  const ref: { posted: { url: string; body: unknown } | null } = { posted: null };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(init.body as string) : null;
    if (method === 'POST' && url.includes('/v1/errand-runs')) {
      ref.posted = { url, body };
      return new Response(JSON.stringify({ errand_run_id: 'er-01HZ00000000' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (method === 'POST' && /\/v1\/incarnations\/[^/]+\/scenarios\//.test(url)) {
      ref.posted = { url, body };
      return new Response(
        JSON.stringify({ apply_id: 'ap-01HZ00000000', incarnation: 'redis-prod', scenario: 'restart' }),
        { status: 202, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (method === 'POST' && url.endsWith('/v1/push/apply')) {
      ref.posted = { url, body };
      return new Response(JSON.stringify({ apply_id: 'pu-01HZ00000000' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (method === 'POST' && url.endsWith('/v1/incarnations')) {
      ref.posted = { url, body };
      return new Response(
        JSON.stringify({ incarnation: 'redis-prod', apply_id: 'ap-create-01' }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }
    // GET-stubs
    if (url.includes('/v1/services?') || url.endsWith('/v1/services')) {
      return new Response(
        JSON.stringify({
          items: [{ name: 'redis', ref: 'main', source: { type: 'git', url: 'git@x' } }],
          offset: 0,
          limit: 50,
          total: 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.includes('/v1/services/redis/scenarios')) {
      return new Response(
        JSON.stringify({
          service: 'redis',
          ref: 'main',
          scenarios: [
            { name: 'create', description: 'init', input_schema: {} },
            { name: 'restart', description: 'restart workers', input_schema: {} },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.includes('/v1/incarnations?')) {
      return new Response(
        JSON.stringify({
          items: [
            { name: 'redis-prod', service: 'redis', service_version: 'main', state_schema_version: 1, covens: ['prod'], status: 'ready', created_by_aid: 'archon-x', created_at: '', updated_at: '' },
          ],
          offset: 0,
          limit: 50,
          total: 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.includes('/v1/souls')) {
      return new Response(
        JSON.stringify({ items: [], offset: 0, limit: 500, total: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.includes('/v1/push-providers')) {
      return new Response(
        JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return ref;
}

describe('RunWizard', () => {
  beforeEach(() => {
    tokenStore.clear();
    // EventSource — нет в jsdom. Stub-минимум.
    // @ts-expect-error — определяем глобально EventSource для jsdom.
    globalThis.EventSource = class {
      readyState = 0;
      onopen: ((ev: Event) => void) | null = null;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      close() {
        /* noop */
      }
      static OPEN = 1;
      static CONNECTING = 0;
      static CLOSED = 2;
    };
  });

  it('Step 1: 3 workload-карточки видны и переключаются', async () => {
    setupFetchStub();
    renderWizardWithRoutes();
    expect(screen.getByLabelText('Scenario apply')).toBeChecked();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Command'));
    expect(screen.getByLabelText('Command')).toBeChecked();
    await user.click(screen.getByLabelText('Push destiny'));
    expect(screen.getByLabelText('Push destiny')).toBeChecked();
  });

  it('Step 2 Scenario params: рендерит select service / scenario / existing incarnation', async () => {
    setupFetchStub();
    renderWizardWithRoutes();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByText('Service')).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument(),
    );
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');
    await waitFor(() =>
      expect(screen.getByLabelText(/Existing incarnation/)).toBeInTheDocument(),
    );
    await user.selectOptions(
      screen.getByLabelText(/Existing incarnation/),
      'redis-prod',
    );
    // Кнопка «Далее» должна разблокироваться.
    expect(screen.getByRole('button', { name: /Далее/ })).not.toBeDisabled();
  });

  it('Step 2 Command params: command текст + module select', async () => {
    setupFetchStub();
    renderWizardWithRoutes();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Module')).toBeInTheDocument());
    expect(screen.getByLabelText('Module')).toHaveValue('core.cmd.shell');
    await user.type(screen.getByLabelText('Command'), 'uptime');
    expect(screen.getByRole('button', { name: /Далее/ })).not.toBeDisabled();
  });

  it('Step 3 Target Glob: переводится в where=sid.glob("…")', async () => {
    const stub = setupFetchStub();
    renderWizardWithRoutes();
    const user = userEvent.setup();
    // → command (чтобы target был обязателен)
    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.type(screen.getByLabelText('Command'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Далее/ }));

    // Step 3
    await waitFor(() => expect(screen.getByText(/Режимы/)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'glob', pressed: false }));
    await user.type(screen.getByLabelText('Glob pattern'), 'prod-*');
    // preview-блок должен показать where выражение
    await waitFor(() =>
      expect(screen.getByText(/sid\.glob\("prod-\*"\)/)).toBeInTheDocument(),
    );

    // Дойти до submit-а
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText('Concurrency')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('errand-run-detail')).toBeInTheDocument());
    expect(stub.posted?.url).toContain('/v1/errand-runs');
    const body = stub.posted?.body as { module: string; target: { where: string }; concurrency: number };
    expect(body.module).toBe('core.cmd.shell');
    expect(body.target.where).toBe('sid.glob("prod-*")');
    expect(body.concurrency).toBe(50);
  });

  it('Submit Scenario без wave → POST .../scenarios/<name> → redirect /incarnations/:name', async () => {
    const stub = setupFetchStub();
    renderWizardWithRoutes();
    const user = userEvent.setup();
    // Step 1 → Step 2 (scenario default)
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument(),
    );
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');
    await waitFor(() =>
      expect(screen.getByLabelText(/Existing incarnation/)).toBeInTheDocument(),
    );
    await user.selectOptions(screen.getByLabelText(/Existing incarnation/), 'redis-prod');
    // Step 2 → 3 → 4
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    // Step 4 → submit
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('incarnation-detail')).toBeInTheDocument());
    expect(stub.posted?.url).toMatch(/\/v1\/incarnations\/redis-prod\/scenarios\/restart$/);
    const body = stub.posted?.body as { input: Record<string, unknown> };
    expect(body.input).toEqual({});
  });

  it('Submit Command → POST /v1/errand-runs → redirect /errand-runs/:id', async () => {
    const stub = setupFetchStub();
    renderWizardWithRoutes();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.type(screen.getByLabelText('Command'), 'uptime');
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    // Step 3: используем coven-режим, чтобы не зависеть от SIDs-checkbox-list-а.
    await user.click(screen.getByRole('button', { name: 'coven', pressed: false }));
    const covenChip = screen.getByLabelText('Coven labels');
    const covenInput = covenChip.querySelector('input') as HTMLInputElement;
    await user.type(covenInput, 'prod ');
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('errand-run-detail')).toBeInTheDocument());
    expect(stub.posted?.url).toContain('/v1/errand-runs');
    const body = stub.posted?.body as { module: string; input: Record<string, unknown>; target: { coven: string[] } };
    expect(body.module).toBe('core.cmd.shell');
    expect(body.input.cmd).toBe('uptime');
    expect(body.target.coven).toEqual(['prod']);
  });
});
