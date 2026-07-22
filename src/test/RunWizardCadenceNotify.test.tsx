/**
 * Guard tests for task B (C-N4): notify block in cadence mode.
 *
 * Invariants:
 *   1. notify-block is visible in cadence mode (permanent subtitle).
 *   2. notify-block is visible in voyage mode (ephemeral subtitle).
 *   3. submitCadence sends notify in the POST /v1/cadences body.
 *   4. Late-binding parity: notify values persist across transitions (like other fields).
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

function setupFetch() {
  const posts: PostCapture[] = [];

  vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? (JSON.parse(init.body as string) as unknown) : null;
    const json = (obj: unknown, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

    if (method === 'POST' && url.includes('/v1/cadences')) {
      posts.push({ url, body });
      return json({ cadence_id: 'cad-notify-01', name: 'test', enabled: true, location: '/v1/cadences/cad-notify-01' }, 201);
    }
    if (method === 'POST' && url.includes('/v1/voyages')) {
      posts.push({ url, body });
      return json({ voyage_id: 'voy-notify-01', kind: 'scenario', scope_size: 1, status: 'pending', location: '' }, 202);
    }
    if (url.includes('/v1/event-types')) {
      return json({ areas: [{ name: 'voyage.*' }, { name: 'scenario_run.*' }], point_events: [] });
    }
    if (url.includes('/v1/heralds')) {
      return json({ items: [{ name: 'ops-webhook', type: 'webhook', config: { url: 'https://example.com' }, secret_ref: null, enabled: true, created_at: '', updated_at: '', created_by_aid: null }], offset: 0, limit: 200, total: 1 });
    }
    if (url.includes('/v1/services/redis/scenarios')) {
      return json({ service: 'redis', ref: 'main', scenarios: [{ name: 'restart', kind: 'operational', input_schema: {} }] });
    }
    if (url.includes('/v1/services')) {
      return json({ items: [{ name: 'redis', ref: 'main', source: { type: 'git', url: 'git@x' } }], offset: 0, limit: 50, total: 1 });
    }
    if (url.includes('/v1/incarnations')) {
      return json({ items: [{ name: 'redis-prod', service: 'redis', service_version: 'main', state_schema_version: 1, covens: ['prod'], status: 'ready', created_by_aid: 'archon-x', created_at: '', updated_at: '' }], offset: 0, limit: 500, total: 1 });
    }
    if (url.includes('/v1/souls')) {
      return json({ items: [], offset: 0, limit: 1000, total: 0 });
    }
    if (url.includes('/v1/modules')) {
      return json({ items: [{ name: 'core.cmd', kind: 'core', states: ['shell'], errand_safe: true, params: [{ name: 'cmd', type: 'string', required: true }] }] });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch);

  return posts;
}

/** Transition to Step 4 in cadence mode (Scenario). */
async function navigateToStep4Cadence(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText('Recurring'));
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
  await waitFor(() => expect(screen.getByTestId('cadence-name')).toBeInTheDocument());
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

describe('RunWizard — notify block in cadence mode (C-N4)', () => {
  it('notify-block is visible in cadence mode (permanent mode)', async () => {
    setupFetch();
    renderWizard();
    const user = userEvent.setup();

    await navigateToStep4Cadence(user);

    // notify-block should be present
    expect(screen.getByTestId('notify-block')).toBeInTheDocument();
  });

  it('notify-block is visible in voyage mode (ephemeral mode)', async () => {
    setupFetch();
    renderWizard();
    const user = userEvent.setup();

    // Voyage (default)
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
    await waitFor(() => expect(screen.getByTestId('notify-block')).toBeInTheDocument());

    expect(screen.getByTestId('notify-block')).toBeInTheDocument();
  });

  it('submitCadence sends notify in the POST /v1/cadences body', async () => {
    const posts = setupFetch();
    renderWizard();
    const user = userEvent.setup();

    await navigateToStep4Cadence(user);

    // Fill in the cadence name
    await user.clear(screen.getByTestId('cadence-name'));
    await user.type(screen.getByTestId('cadence-name'), 'redis-hourly');

    // Add notify
    await user.click(screen.getByTestId('notify-add-btn'));

    // Herald select
    const heraldSelects = await screen.findAllByTestId(/notify-herald-select-/);
    await waitFor(() =>
      expect(heraldSelects[0].querySelector('option[value="ops-webhook"]')).toBeInTheDocument(),
    );
    await user.selectOptions(heraldSelects[0], 'ops-webhook');

    // Submit
    await user.click(screen.getByRole('button', { name: /Create schedule/ }));
    await waitFor(() => expect(screen.getByTestId('cadence-detail')).toBeInTheDocument());

    const cadencePosts = posts.filter((p) => (p.url as string).includes('/v1/cadences'));
    expect(cadencePosts).toHaveLength(1);

    const body = cadencePosts[0].body as Record<string, unknown>;
    expect(body.notify).toBeDefined();
    const notifyArr = body.notify as Array<{ herald: string }>;
    expect(Array.isArray(notifyArr)).toBe(true);
    expect(notifyArr.length).toBeGreaterThan(0);
    expect(notifyArr[0].herald).toBe('ops-webhook');
  });

  it('submitCadence without notify — no notify field in the body', async () => {
    const posts = setupFetch();
    renderWizard();
    const user = userEvent.setup();

    await navigateToStep4Cadence(user);

    await user.clear(screen.getByTestId('cadence-name'));
    await user.type(screen.getByTestId('cadence-name'), 'redis-hourly');

    // don't add notify
    await user.click(screen.getByRole('button', { name: /Create schedule/ }));
    await waitFor(() => expect(screen.getByTestId('cadence-detail')).toBeInTheDocument());

    const cadencePosts = posts.filter((p) => (p.url as string).includes('/v1/cadences'));
    expect(cadencePosts).toHaveLength(1);

    const body = cadencePosts[0].body as Record<string, unknown>;
    // notify is not sent when empty
    expect(body.notify).toBeUndefined();
  });
});
