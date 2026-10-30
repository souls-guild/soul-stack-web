import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { RunWizard } from '../pages/run/RunWizard';
import { MAINTENANCE_PROBE_LIMIT } from '../pages/run/maintenanceProbe';
import { tokenStore } from '../api/tokenStore';

// The Run dialog's half of ADR-0093 (NIM-1076): "Run in the maintenance window" and the
// mandatory freeze consent. Instants render in the browser zone, pinned here.
vi.mock('../pages/incarnations/maintenance', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../pages/incarnations/maintenance')>();
  return { ...mod, browserTimeZone: () => 'Europe/Moscow' };
});

const SALE = {
  id: 'f-sale',
  starts_at: '2026-01-01T00:00:00Z',
  ends_at: '2099-12-02T21:00:00Z',
  comment: 'Sale',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const LATER = { ...SALE, id: 'f-later', starts_at: '2099-06-01T00:00:00Z', ends_at: '2099-06-10T00:00:00Z', comment: 'Audit' };
const NIGHT = {
  id: 'w-night',
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  start_time: '02:00',
  duration_minutes: 180,
  timezone: 'Europe/Moscow',
  comment: '',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

interface Incarnation {
  windows: unknown[];
  status: Record<string, unknown>;
  freezes?: unknown[];
  defaults?: unknown[];
}

interface Captured {
  posts: Array<{ url: string; body: Record<string, unknown> }>;
  maintenanceReads: string[];
}

function stub(incarnations: Record<string, Incarnation>, opts: { refuseFirst?: boolean } = {}): Captured {
  const cap: Captured = { posts: [], maintenanceReads: [] };
  let refused = false;
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const json = (obj: unknown, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

    if (method === 'POST' && (url.endsWith('/v1/voyages') || url.endsWith('/v1/cadences'))) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      cap.posts.push({ url, body });
      if (opts.refuseFirst && !refused && !body.confirm_freeze) {
        refused = true;
        return json(
          { type: 'https://soul-stack.dev/problems/freeze-active', title: 'Conflict', status: 409, detail: 'df-prod: freeze "Sale" until 2099-12-02T21:00:00Z' },
          409,
        );
      }
      if (url.endsWith('/v1/cadences')) return json({ cadence_id: 'cad-1' }, 201);
      return json({ voyage_id: 'voy-1', kind: 'scenario', scope_size: 1, status: 'pending' }, 202);
    }
    if (url.includes('/v1/services?') || url.endsWith('/v1/services')) {
      return json({ items: [{ id: 'redis', ref: 'main', source: { type: 'git', url: 'git@x' } }], offset: 0, limit: 50, total: 1 });
    }
    if (url.includes('/v1/services/redis/scenarios')) {
      return json({ service: 'redis', ref: 'main', scenarios: [{ name: 'restart', kind: 'operational', description: 'restart', input_schema: {} }] });
    }
    const mw = url.match(/\/v1\/incarnations\/([^/?]+)\/(maintenance-windows|freezes)$/);
    if (mw) {
      cap.maintenanceReads.push(url);
      const inc = incarnations[decodeURIComponent(mw[1])];
      if (!inc) return json({ title: 'Not Found' }, 404);
      return mw[2] === 'freezes'
        ? json({ items: inc.freezes ?? [] })
        : json({ items: inc.windows, status: inc.status, ...(inc.defaults ? { defaults: inc.defaults } : {}) });
    }
    const members = url.match(/\/v1\/incarnations\/([^/?]+)\/members$/);
    if (members) return json({ items: [], offset: 0, limit: 0, total: 0 });
    if (url.includes('/v1/incarnations?') || url.endsWith('/v1/incarnations')) {
      const items = Object.keys(incarnations).map((id) => ({
        id,
        service: 'redis',
        service_version: 'main',
        state_schema_version: 1,
        covens: [],
        status: 'ready',
        status_details: {},
        created_by_aid: 'archon-x',
        created_at: '',
        updated_at: '',
      }));
      return json({ items, offset: 0, limit: 500, total: items.length });
    }
    return json({}, 404);
  }) as typeof fetch);
  return cap;
}

function renderWizard(path: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 }, mutations: { retry: false } },
  });
  function Wrap({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(
    <Routes>
      <Route path="/run" element={<RunWizard />} />
      <Route path="/voyages/:id" element={<div data-testid="voyage-detail" />} />
      <Route path="/cadences/:id" element={<div data-testid="cadence-detail" />} />
    </Routes>,
    { wrapper: Wrap },
  );
}

async function toStep4(user: ReturnType<typeof userEvent.setup>, regex = '^df-prod$') {
  await user.click(screen.getByRole('button', { name: /Next/ }));
  await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
  await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');
  await user.click(screen.getByRole('button', { name: /Next/ }));
  const re = await screen.findByLabelText('Incarnation regex');
  await user.clear(re);
  await user.type(re, regex);
  await waitFor(() => expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: /Next/ }));
  await screen.findByTestId('run-maintenance');
}

const runButton = () => screen.getByRole('button', { name: /^Run$/ });

describe('RunWizard — maintenance window and freeze consent', () => {
  beforeEach(() => {
    tokenStore.clear();
    sessionStorage.clear();
  });

  it('[GUARD] during a freeze «Run» stays disabled until consent is ticked, and the request carries confirm_freeze', async () => {
    const cap = stub({
      'df-prod': { windows: [NIGHT], status: { open_now: false, next_start: '2099-12-03T23:00:00Z', active_freeze: SALE }, freezes: [SALE] },
    });
    renderWizard('/run?workload=scenario&service=redis');
    const user = userEvent.setup();
    await toStep4(user);

    const row = await screen.findByTestId('run-frozen-df-prod');
    expect(row.textContent).toBe('df-prod: freeze until Thu 03.12.2099 00:00 · Sale');
    expect(runButton()).toBeDisabled();

    await user.click(screen.getByTestId('run-confirm-freeze'));
    expect(runButton()).toBeEnabled();
    await user.click(runButton());

    await screen.findByTestId('voyage-detail');
    expect(cap.posts).toHaveLength(1);
    expect(cap.posts[0].body.confirm_freeze).toBe(true);
    expect(cap.posts[0].body).not.toHaveProperty('in_maintenance_window');
  });

  it('«Run in the maintenance window» needs no consent, shows the next start and sends the flag', async () => {
    const cap = stub({
      'df-prod': { windows: [NIGHT], status: { open_now: false, next_start: '2099-12-03T23:00:00Z', active_freeze: SALE } },
    });
    renderWizard('/run?workload=scenario&service=redis');
    const user = userEvent.setup();
    await toStep4(user);

    await screen.findByTestId('run-freeze-block');
    await user.click(screen.getByTestId('run-in-window'));
    expect(screen.queryByTestId('run-freeze-block')).not.toBeInTheDocument();
    expect(screen.getByTestId('run-next-starts').textContent).toContain('df-prod: next start Fri 04.12.2099 02:00');
    expect(runButton()).toBeEnabled();
    await user.click(runButton());

    await screen.findByTestId('voyage-detail');
    expect(cap.posts[0].body.in_maintenance_window).toBe(true);
    expect(cap.posts[0].body).not.toHaveProperty('confirm_freeze');
  });

  it('over several incarnations the hint names one start, no earlier than the latest next start', async () => {
    stub({
      'df-a': { windows: [NIGHT], status: { open_now: false, next_start: '2099-12-03T23:00:00Z' } },
      'df-b': { windows: [NIGHT], status: { open_now: false, next_start: '2099-12-05T23:00:00Z' } },
    });
    renderWizard('/run?workload=scenario&service=redis');
    const user = userEvent.setup();
    await toStep4(user, '^df-');

    await user.click(screen.getByTestId('run-in-window'));
    const hint = await screen.findByTestId('run-common-start');
    expect(hint.textContent).toContain('not before Sun 06.12.2099 02:00');
    // Each line is that incarnation's window, never a start of its own.
    const lines = screen.getByTestId('run-next-starts').textContent ?? '';
    expect(lines).toContain('df-a: open from Fri 04.12.2099 02:00');
    expect(lines).not.toMatch(/starts at once|next start/);
  });

  it('[GUARD] an incarnation on the cluster default has windows; one whose only window has ended has none', async () => {
    const { days, start_time, duration_minutes, timezone } = NIGHT;
    const ended = { ...NIGHT, id: 'o-old', kind: 'once', days: undefined, starts_at: '2020-01-01T00:00:00Z', ends_at: '2020-01-01T01:00:00Z' };
    const openNow = { open_now: true, next_start: '2026-10-27T10:00:00Z' };
    stub({
      'df-default': { windows: [], defaults: [{ kind: 'weekly', days, start_time, duration_minutes, timezone, comment: '' }], status: { ...openNow, source: 'default' } },
      // The server names the default but the reply carries no slots: still windows.
      'df-named': { windows: [], status: { ...openNow, source: 'default' } },
      'df-ended': { windows: [ended], status: { ...openNow, source: 'none' } },
    });
    renderWizard('/run?workload=scenario&service=redis');
    const user = userEvent.setup();
    await toStep4(user, '^df-');

    await user.click(screen.getByTestId('run-in-window'));
    const lines = (await screen.findByTestId('run-next-starts')).textContent ?? '';
    expect(lines).toContain('df-default: open now');
    expect(lines).toContain('df-named: open now');
    expect(lines).toContain('df-ended: no windows');
  });

  it('no freeze: nothing to consent to, and no gate fields are sent', async () => {
    const cap = stub({ 'df-prod': { windows: [], status: { open_now: true, next_start: '2026-10-27T10:00:00Z' } } });
    renderWizard('/run?workload=scenario&service=redis');
    const user = userEvent.setup();
    await toStep4(user);

    await waitFor(() => expect(cap.maintenanceReads.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('run-freeze-block')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('run-in-window'));
    expect(screen.getByTestId('run-next-starts').textContent).toContain('df-prod: no windows, starts at once');
    await user.click(screen.getByTestId('run-in-window'));
    await user.click(runButton());

    await screen.findByTestId('voyage-detail');
    expect(cap.posts[0].body).not.toHaveProperty('confirm_freeze');
    expect(cap.posts[0].body).not.toHaveProperty('in_maintenance_window');
  });

  it('a freeze over schedule_at needs consent though none is in force now', async () => {
    stub({
      'df-prod': { windows: [], status: { open_now: true, next_start: '2026-10-27T10:00:00Z' }, freezes: [LATER] },
    });
    renderWizard('/run?workload=scenario&service=redis');
    const user = userEvent.setup();
    await toStep4(user);

    expect(screen.queryByTestId('run-freeze-block')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Schedule at'), { target: { value: '2099-06-05T12:00' } });
    expect((await screen.findByTestId('run-frozen-df-prod')).textContent).toBe('df-prod: freeze until Wed 10.06.2099 03:00 · Audit');
    expect(runButton()).toBeDisabled();
  });

  it('a 409 freeze-active the probe missed opens the consent block, and the retry carries consent', async () => {
    const cap = stub(
      { 'df-prod': { windows: [], status: { open_now: true, next_start: '2026-10-27T10:00:00Z' } } },
      { refuseFirst: true },
    );
    renderWizard('/run?workload=scenario&service=redis');
    const user = userEvent.setup();
    await toStep4(user);

    await user.click(runButton());
    const block = await screen.findByTestId('run-freeze-block');
    expect(block.textContent).toContain('Keeper refused the run: df-prod: freeze "Sale"');
    expect(runButton()).toBeDisabled();

    await user.click(screen.getByTestId('run-confirm-freeze'));
    await user.click(runButton());
    await screen.findByTestId('voyage-detail');
    expect(cap.posts).toHaveLength(2);
    expect(cap.posts[1].body.confirm_freeze).toBe(true);
  });

  it('[GUARD] consent given at one start time does not carry over to another', async () => {
    const cap = stub(
      { 'df-prod': { windows: [], status: { open_now: true, next_start: '2026-10-27T10:00:00Z' } } },
      { refuseFirst: true },
    );
    renderWizard('/run?workload=scenario&service=redis');
    const user = userEvent.setup();
    await toStep4(user);

    await user.click(runButton());
    await screen.findByTestId('run-freeze-block');
    await user.click(screen.getByTestId('run-confirm-freeze'));
    fireEvent.change(screen.getByLabelText('Schedule at'), { target: { value: '2099-06-05T12:00' } });

    // The refusal was about "now"; at the new time nothing is known to be frozen.
    expect(screen.queryByTestId('run-freeze-block')).not.toBeInTheDocument();
    await user.click(runButton());
    await screen.findByTestId('voyage-detail');
    expect(cap.posts).toHaveLength(2);
    expect(cap.posts[1].body).not.toHaveProperty('confirm_freeze');
  });

  it(`past ${MAINTENANCE_PROBE_LIMIT} targets the wizard does not probe and says so`, async () => {
    const many: Record<string, Incarnation> = {};
    for (let i = 0; i <= MAINTENANCE_PROBE_LIMIT; i++) {
      many[`df-${String(i).padStart(2, '0')}`] = { windows: [], status: { open_now: true, next_start: '2026-10-27T10:00:00Z' } };
    }
    const cap = stub(many);
    renderWizard('/run?workload=scenario&service=redis');
    const user = userEvent.setup();
    await toStep4(user, '^df-');

    expect(screen.getByTestId('run-maintenance-capped')).toBeInTheDocument();
    expect(cap.maintenanceReads).toHaveLength(0);
  });

  it('Cadence: the option is sent as in_maintenance_window, and there is no consent', async () => {
    const cap = stub({
      'df-prod': { windows: [NIGHT], status: { open_now: false, next_start: '2099-12-03T23:00:00Z', active_freeze: SALE } },
    });
    renderWizard('/run?workload=scenario&service=redis&recurrence=true');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    const re = await screen.findByLabelText('Incarnation regex');
    await user.type(re, '^df-prod$');
    await waitFor(() => expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Next/ }));

    await user.type(await screen.findByTestId('cadence-name'), 'nightly');
    await user.click(screen.getByTestId('cadence-in-window'));
    expect(screen.queryByTestId('run-confirm-freeze')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Create schedule/ }));

    await screen.findByTestId('cadence-detail');
    expect(cap.posts[0].url).toContain('/v1/cadences');
    expect(cap.posts[0].body.in_maintenance_window).toBe(true);
    expect(cap.maintenanceReads).toHaveLength(0);
  });
});
