/**
 * RunWizard Cadence (recurrence) — tests for the "Regular" mode.
 * Tests runMode switching, submit -> POST /v1/cadences.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { RunWizard } from '../pages/run/RunWizard';
import { tokenStore } from '../api/tokenStore';

function renderWizard(initialPath = '/run') {
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
      <Route path="/cadences/:id" element={<div data-testid="cadence-detail" />} />
      <Route path="/voyages/:id" element={<div data-testid="voyage-detail" />} />
    </Routes>,
    { wrapper: Wrap },
  );
}

interface PostCapture {
  url: string;
  body: unknown;
}

function setupFetch(opts: { capturedPosts?: PostCapture[] } = {}) {
  const posts: PostCapture[] = opts.capturedPosts ?? [];

  vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? (JSON.parse(init.body as string) as unknown) : null;
    const json = (obj: unknown, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

    if (method === 'POST' && url.includes('/v1/cadences')) {
      posts.push({ url, body });
      return json({ cadence_id: 'cad-new-01', name: 'test', enabled: true, location: '/v1/cadences/cad-new-01' }, 201);
    }
    if (method === 'POST' && url.includes('/v1/voyages')) {
      posts.push({ url, body });
      return json({ voyage_id: 'voy-01', kind: 'scenario', scope_size: 1, status: 'pending', location: '' }, 202);
    }

    // GET stubs — more specific ones BEFORE general ones
    if (url.includes('/v1/services/redis/scenarios')) {
      return json({ service: 'redis', ref: 'main', scenarios: [{ name: 'restart', kind: 'operational', input_schema: {} }] });
    }
    if (url.includes('/v1/services')) {
      return json({
        items: [{ name: 'redis', ref: 'main', source: { type: 'git', url: 'git@x' } }],
        offset: 0, limit: 50, total: 1,
      });
    }
    if (url.includes('/v1/souls')) {
      return json({ items: [], offset: 0, limit: 1000, total: 0 });
    }
    if (url.includes('/v1/modules')) {
      return json({ items: [{ name: 'core.cmd', kind: 'core', states: ['shell'], errand_safe: true, params: [{ name: 'cmd', type: 'string', required: true }] }] });
    }
    if (url.includes('/v1/incarnations')) {
      return json({
        items: [{ name: 'redis-prod', service: 'redis', service_version: 'main', state_schema_version: 1, covens: ['prod'], status: 'ready', created_by_aid: 'archon-x', created_at: '', updated_at: '' }],
        offset: 0, limit: 500, total: 1,
      });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch);

  return posts;
}

beforeEach(() => {
  tokenStore.set('tok-test');
  sessionStorage.clear();
  // @ts-expect-error EventSource not in jsdom
  globalThis.EventSource = class {
    readyState = 0;
    close() {}
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSED = 2;
  };
});
describe('RunWizard — Cadence mode (recurrence)', () => {
  it('Step 1 shows run mode toggle One-time/Recurring', () => {
    setupFetch();
    renderWizard();

    expect(screen.getByLabelText('One-time')).toBeInTheDocument();
    expect(screen.getByLabelText('Recurring')).toBeInTheDocument();
    // Default — Once
    expect(screen.getByLabelText('One-time')).toBeChecked();
  });

  it('?recurrence=true → defaults to "Recurring"', () => {
    setupFetch();
    renderWizard('/run?recurrence=true');

    expect(screen.getByLabelText('Recurring')).toBeChecked();
  });

  it('Scenario + Cadence (interval): submit → POST /v1/cadences with schedule_kind=interval', async () => {
    const posts = setupFetch();
    renderWizard();
    const user = userEvent.setup();

    // Step 1: switch to "Regular"
    await user.click(screen.getByLabelText('Recurring'));
    expect(screen.getByLabelText('Recurring')).toBeChecked();

    // Next: Step 2 — select service+scenario
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    // Step 3 — incarnation regex
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    // Step 4 — cadence fields should appear
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('cadence-name')).toBeInTheDocument());

    // Fill in the Cadence name
    await user.clear(screen.getByTestId('cadence-name'));
    await user.type(screen.getByTestId('cadence-name'), 'redis-hourly');

    // schedule_kind=interval (default), interval=3600 (default)
    expect(screen.getByLabelText('schedule_kind_interval')).toBeChecked();
    expect(screen.getByLabelText('Interval seconds')).toHaveValue(3600);

    // overlap=skip (default)
    expect(screen.getByLabelText('Overlap policy')).toHaveValue('skip');

    // Submit
    await user.click(screen.getByRole('button', { name: /Create schedule/ }));
    await waitFor(() => expect(screen.getByTestId('cadence-detail')).toBeInTheDocument());

    // Check the request body
    const cadencePosts = posts.filter((p) => (p.url as string).includes('/v1/cadences'));
    expect(cadencePosts).toHaveLength(1);
    const body = cadencePosts[0].body as Record<string, unknown>;
    expect(body.name).toBe('redis-hourly');
    expect(body.schedule_kind).toBe('interval');
    expect(body.interval_seconds).toBe(3600);
    expect(body.cron_expr).toBeUndefined();
    expect(body.overlap_policy).toBe('skip');
    expect(body.kind).toBe('scenario');
    expect(body.scenario_name).toBe('restart');
  });

  it('Scenario + Cadence (cron): submit → POST /v1/cadences with schedule_kind=cron', async () => {
    const posts = setupFetch();
    renderWizard();
    const user = userEvent.setup();

    // Step 1: "Regular"
    await user.click(screen.getByLabelText('Recurring'));

    // Step 2: scenario
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    // Step 3: regex
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('Incarnation regex')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    // Step 4: switch to cron
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText('schedule_kind_cron')).toBeInTheDocument());

    await user.click(screen.getByLabelText('schedule_kind_cron'));
    await waitFor(() => expect(screen.getByLabelText('Cron expression')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Cron expression'), '0 */6 * * *');
    await user.clear(screen.getByTestId('cadence-name'));
    await user.type(screen.getByTestId('cadence-name'), 'redis-cron');

    // overlap: queue
    await user.selectOptions(screen.getByLabelText('Overlap policy'), 'queue');

    await user.click(screen.getByRole('button', { name: /Create schedule/ }));
    await waitFor(() => expect(screen.getByTestId('cadence-detail')).toBeInTheDocument());

    const cadencePosts = posts.filter((p) => (p.url as string).includes('/v1/cadences'));
    expect(cadencePosts).toHaveLength(1);
    const body = cadencePosts[0].body as Record<string, unknown>;
    expect(body.schedule_kind).toBe('cron');
    expect(body.cron_expr).toBe('0 */6 * * *');
    expect(body.interval_seconds).toBeUndefined();
    expect(body.overlap_policy).toBe('queue');
  });

  it('Cadence: empty name → submit disabled', async () => {
    setupFetch();
    renderWizard();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Recurring'));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Service/), 'redis');
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.type(screen.getByLabelText('Incarnation regex'), '*');
    await waitFor(() =>
      expect(screen.getByLabelText('Matched incarnations').textContent).toContain('redis-prod'),
    );

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('cadence-name')).toBeInTheDocument());

    // Name is empty -> submit disabled
    expect(screen.getByRole('button', { name: /Create schedule/ })).toBeDisabled();
  });
});
