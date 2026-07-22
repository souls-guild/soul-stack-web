/**
 * Guard tests: late-binding bug for Command+Cadence.
 *
 * Key invariants:
 *   1. Command+Cadence with coven -> POST /v1/cadences body.target.coven == [covens],
 *      body.target.sids is ABSENT (not a snapshot).
 *   2. Command+Voyage (one-off) -> body.target.sids == resolvedSids, NOT coven.
 *   3. Cadence with regex/soulprint AND coven -> cadence-early-binding-warn banner visible.
 *   4. Cadence with only regex (no coven) -> cadence-snapshot-only-warn banner visible.
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

function setupFetch(
  souls: Array<{ sid: string; covens?: string[] }> = [],
): { posts: PostCapture[] } {
  const posts: PostCapture[] = [];

  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : null;
      const json = (obj: unknown, status = 200) =>
        new Response(JSON.stringify(obj), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });

      if (method === 'POST' && url.includes('/v1/cadences')) {
        posts.push({ url, body });
        return json(
          { cadence_id: 'cad-lb-01', name: 'test', enabled: true, location: '/v1/cadences/cad-lb-01' },
          201,
        );
      }
      if (method === 'POST' && (url.endsWith('/v1/voyages') || url.endsWith('/v1/voyages/'))) {
        posts.push({ url, body });
        return json(
          { voyage_id: 'voy-lb-01', kind: 'command', scope_size: 1, status: 'pending', location: '' },
          202,
        );
      }
      if (method === 'POST' && url.includes('/v1/voyages/preview')) {
        return json({ kind: 'command', scope_size: 1, total_batches: 1, batch_mode: 'barrier' });
      }

      if (url.includes('/v1/souls')) {
        return json({
          items: souls.map((s) => ({
            sid: s.sid,
            transport: 'agent',
            status: 'connected',
            covens: s.covens ?? [],
            registered_at: '',
          })),
          offset: 0,
          limit: 1000,
          total: souls.length,
        });
      }
      if (url.includes('/v1/modules')) {
        return json({
          items: [
            {
              name: 'core.cmd',
              kind: 'core',
              states: ['shell'],
              errand_safe: true,
              params: [{ name: 'cmd', type: 'string', required: true, multiline: true }],
            },
          ],
        });
      }
      if (url.includes('/v1/services')) {
        return json({ items: [], offset: 0, limit: 50, total: 0 });
      }
      if (url.includes('/v1/incarnations')) {
        return json({ items: [], offset: 0, limit: 500, total: 0 });
      }
      return new Response('{}', { status: 404 });
    },
  );

  return { posts };
}

/** Navigation: Step1 Command -> select coven -> Step3 -> Step4 + cadence-fields */
async function navigateToStep4CommandCadence(user: ReturnType<typeof userEvent.setup>) {
  // Step 1: select Command + "Recurring" mode
  await user.click(screen.getByLabelText('Command'));
  await user.click(screen.getByLabelText('Recurring'));
  await user.click(screen.getByRole('button', { name: /Next/ }));

  // Step 2: enter coven. ChipsInput: aria-label on the div container, input is nested.
  const covenChip = await screen.findByLabelText('Coven labels');
  const covenInputEl = covenChip.querySelector('input') as HTMLInputElement;
  await user.type(covenInputEl, 'web-prod ');

  // Wait for host resolution (query async), otherwise the Next button is disabled.
  // "1 hosts match" / "2 hosts match" etc.
  await waitFor(() =>
    expect(screen.getByLabelText('Host preview').textContent).toMatch(/\d+ hosts match/),
  );

  // Next button should become enabled after resolution
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Next/ })).not.toBeDisabled(),
  );

  // Go to Step 3
  await user.click(screen.getByRole('button', { name: /Next/ }));

  // Step 3: wait for the module field, fill in cmd
  await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
  await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');

  // Go to Step 4
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

describe('Command+Cadence late-binding guard', () => {
  it('Cadence with coven → POST /v1/cadences body.target.coven == ["web-prod"], NOT sids', async () => {
    const { posts } = setupFetch([{ sid: 'host-01.example.com', covens: ['web-prod'] }]);
    renderWizard();
    const user = userEvent.setup();

    await navigateToStep4CommandCadence(user);

    await user.clear(screen.getByTestId('cadence-name'));
    await user.type(screen.getByTestId('cadence-name'), 'web-hourly');
    await user.click(screen.getByRole('button', { name: /Create schedule/ }));
    await waitFor(() => expect(screen.getByTestId('cadence-detail')).toBeInTheDocument());

    const cadPosts = posts.filter((p) => (p.url as string).includes('/v1/cadences'));
    expect(cadPosts).toHaveLength(1);

    const body = cadPosts[0].body as Record<string, unknown>;
    const target = body.target as Record<string, unknown> | undefined;
    expect(target).toBeDefined();

    // Main regression guard: if someone returns resolvedSids — this assert will fail.
    expect(target!.sids).toBeUndefined();
    expect(target!.coven).toEqual(['web-prod']);
  });

  it('Command Voyage (one-off) with coven → body.target.sids == resolvedSids (snapshot preserved)', async () => {
    const { posts } = setupFetch([{ sid: 'host-01.example.com', covens: ['web-prod'] }]);
    renderWizard();
    const user = userEvent.setup();

    // Step 1: Command + "Once" mode (default)
    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    // Step 2: enter coven
    const covenChip = await screen.findByLabelText('Coven labels');
    const covenInputEl = covenChip.querySelector('input') as HTMLInputElement;
    await user.type(covenInputEl, 'web-prod ');

    // Wait for host resolution
    await waitFor(() =>
      expect(screen.getByLabelText('Host preview').textContent).toMatch(/\d+ hosts match/),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Next/ })).not.toBeDisabled(),
    );

    // Go to Step 3
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');

    // Step 4
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Run/ })).not.toBeDisabled());

    await user.click(screen.getByRole('button', { name: /Run/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const voyPosts = posts.filter((p) => (p.url as string).includes('/v1/voyages'));
    expect(voyPosts).toHaveLength(1);

    const body = voyPosts[0].body as Record<string, unknown>;
    const target = body.target as Record<string, unknown> | undefined;
    expect(target).toBeDefined();

    // One-off Voyage should send snapshot sids, NOT coven.
    expect(target!.sids).toEqual(['host-01.example.com']);
    expect(target!.coven).toBeUndefined();
  });

  it('Cadence + coven + sidRegex → cadence-early-binding-warn banner visible', async () => {
    setupFetch([{ sid: 'host-01.example.com', covens: ['web-prod'] }]);
    renderWizard();
    const user = userEvent.setup();

    // Step 1: Command + Recurring
    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByLabelText('Recurring'));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    // Step 2: enter coven + sidRegex
    const covenChip = await screen.findByLabelText('Coven labels');
    const covenInputEl = covenChip.querySelector('input') as HTMLInputElement;
    await user.type(covenInputEl, 'web-prod ');
    await user.type(screen.getByLabelText('SID regex'), 'host-.*');

    // earlyBinding banner should appear
    await waitFor(() =>
      expect(screen.getByTestId('cadence-early-binding-warn')).toBeInTheDocument(),
    );
    // snapshotOnly banner should NOT appear (coven is set)
    expect(screen.queryByTestId('cadence-snapshot-only-warn')).not.toBeInTheDocument();
  });

  it('Cadence + sidRegex only (no coven) → cadence-snapshot-only-warn banner visible', async () => {
    setupFetch([{ sid: 'host-01.example.com', covens: ['web-prod'] }]);
    renderWizard();
    const user = userEvent.setup();

    // Step 1: Command + Recurring
    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByLabelText('Recurring'));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    // Step 2: only sidRegex, no coven
    await waitFor(() => screen.getByLabelText('SID regex'));
    await user.type(screen.getByLabelText('SID regex'), 'host-.*');

    // snapshotOnly banner should appear
    await waitFor(() =>
      expect(screen.getByTestId('cadence-snapshot-only-warn')).toBeInTheDocument(),
    );
    // earlyBinding banner should NOT appear (no coven)
    expect(screen.queryByTestId('cadence-early-binding-warn')).not.toBeInTheDocument();
  });
});
