import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';
import { RunsFeed } from '../pages/runs/RunsFeed';
import { IncarnationDetail } from '../pages/incarnations/IncarnationDetail';
import { CadenceDetail } from '../pages/cadences/CadenceDetail';

// A run deferred to a maintenance window is a scheduled Voyage (ADR-0093 §3): it reads
// «deferred until …» wherever runs are listed, and it can be cancelled there.
vi.mock('../pages/incarnations/maintenance', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../pages/incarnations/maintenance')>();
  return { ...mod, browserTimeZone: () => 'Europe/Moscow' };
});

const DEFERRED = {
  voyage_id: '01VDEFERRED00000000000001',
  kind: 'scenario',
  scenario_name: 'restart',
  status: 'scheduled',
  schedule_at: '2026-12-09T23:00:00Z',
  target: { service: 'dragonfly', incarnations: ['df-prod'] },
  scope_size: 1,
  total_batches: 1,
  current_batch_index: 0,
  dry_run: false,
  attempt: 0,
  started_by_aid: 'archon-alice',
  created_at: '2026-10-27T14:00:00Z',
};
const OTHER = { ...DEFERRED, voyage_id: '01VDEFERRED00000000000002', target: { service: 'dragonfly', incarnations: ['df-stage'] } };
const EMPTY = { items: [], offset: 0, limit: 50, total: 0 };

function sent(method: string, prefix: string): string[] {
  const calls = (fetch as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls;
  return calls.filter(([u, init]) => (init?.method ?? 'GET') === method && u.startsWith(prefix)).map(([u]) => u);
}

describe('deferred runs', () => {
  beforeEach(() => {
    tokenStore.clear();
    // The year is dropped inside the current one; only Date is faked.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-27T12:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the runs feed shows «deferred until» on a scheduled Voyage and cancels it after confirmation', async () => {
    installFetchMock([
      { method: 'DELETE', url: `/v1/voyages/${DEFERRED.voyage_id}`, body: { voyage_id: DEFERRED.voyage_id, status: 'cancelled' } },
      { method: 'GET', url: '/v1/voyages', body: { items: [DEFERRED], offset: 0, limit: 50, total: 1 } },
      { method: 'GET', url: '/v1/push-runs', body: EMPTY },
      { method: 'GET', url: '/v1/errands', body: EMPTY },
      { method: 'GET', url: '/v1/runs', body: EMPTY },
    ]);
    renderWithProviders(<RunsFeed />, '/runs');
    const user = userEvent.setup();

    expect((await screen.findByTestId(`deferred-until-${DEFERRED.voyage_id}`)).textContent).toBe('deferred until Thu 10.12 02:00');
    await user.click(screen.getByTestId(`deferred-cancel-${DEFERRED.voyage_id}`));
    expect(sent('DELETE', '/v1/voyages')).toHaveLength(0);
    await user.click(screen.getByTestId(`deferred-cancel-confirm-${DEFERRED.voyage_id}`));
    await waitFor(() => expect(sent('DELETE', `/v1/voyages/${DEFERRED.voyage_id}`)).toHaveLength(1));
  });

  it('the incarnation History tab asks for its own deferred runs and shows them', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/voyages', body: { items: [DEFERRED], offset: 0, limit: 200, total: 1 } },
      { method: 'GET', url: '/v1/incarnations/df-prod/members', body: { items: [], offset: 0, limit: 0, total: 0 } },
      { method: 'GET', url: '/v1/incarnations/df-prod/runs', body: { items: [], offset: 0, limit: 50, total: 0 } },
      {
        method: 'GET',
        url: '/v1/incarnations/df-prod',
        body: {
          id: 'df-prod',
          service: 'dragonfly',
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
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/df-prod',
    );
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'df-prod' });
    await user.click(screen.getAllByRole('tab').find((t) => /History/.test(t.textContent ?? ''))!);

    const row = await screen.findByTestId(`deferred-run-row-${DEFERRED.voyage_id}`);
    expect(row.textContent).toContain('restart');
    expect(row.textContent).toContain('deferred until Thu 10.12 02:00');
    // Keeper narrows the list to the incarnation (NIM-1074); the tab must ask it to.
    const query = new URLSearchParams(sent('GET', '/v1/voyages?')[0].split('?')[1]);
    expect(query.get('incarnation')).toBe('df-prod');
    expect(query.get('status')).toBe('scheduled');
    expect(query.get('kind')).toBe('scenario');
  });

  it('a Cadence lists its deferred child as «deferred until», and the window option is toggled by PATCH', async () => {
    const CAD = {
      cadence_id: 'cad-1',
      name: 'nightly',
      kind: 'scenario',
      scenario_name: 'restart',
      enabled: true,
      schedule_kind: 'cron',
      cron_expr: '0 14 * * *',
      overlap_policy: 'skip',
      in_maintenance_window: false,
      target: { incarnations: ['df-prod'] },
      created_by_aid: 'archon-alice',
      created_at: '2026-10-27T10:00:00Z',
    };
    installFetchMock([
      { method: 'GET', url: '/v1/me/permissions', body: { permissions: [{ resource: 'cadence', action: 'update', wildcard: false }] } },
      { method: 'GET', url: '/v1/cadences/cad-1/runs', body: { items: [OTHER], offset: 0, limit: 50, total: 1 } },
      { method: 'PATCH', url: '/v1/cadences/cad-1', body: { ...CAD, in_maintenance_window: true } },
      { method: 'GET', url: '/v1/cadences/cad-1', body: CAD },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/cadences/:id" element={<CadenceDetail />} />
      </Routes>,
      '/cadences/cad-1',
    );
    const user = userEvent.setup();

    expect((await screen.findByTestId(`deferred-until-${OTHER.voyage_id}`)).textContent).toBe('deferred until Thu 10.12 02:00');
    expect(screen.getByTestId('cadence-in-window-value').textContent).toContain('any time outside a freeze');
    await user.click(screen.getByTestId('cadence-in-window-toggle'));
    await waitFor(() => expect(sent('PATCH', '/v1/cadences/cad-1')).toHaveLength(1));
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls;
    const patch = calls.find(([u, i]) => i?.method === 'PATCH' && u.startsWith('/v1/cadences/cad-1'));
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ in_maintenance_window: true });
  });

  it('a command Cadence offers no window option', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/me/permissions', body: { permissions: [{ resource: 'cadence', action: 'update', wildcard: false }] } },
      { method: 'GET', url: '/v1/cadences/cad-2/runs', body: { items: [], offset: 0, limit: 50, total: 0 } },
      {
        method: 'GET',
        url: '/v1/cadences/cad-2',
        body: {
          cadence_id: 'cad-2', name: 'uptime', kind: 'command', module: 'core.cmd.shell', enabled: true,
          schedule_kind: 'interval', interval_seconds: 3600, overlap_policy: 'skip', in_maintenance_window: false,
          target: { sids: ['h1'] }, created_by_aid: 'archon-alice', created_at: '2026-10-27T10:00:00Z',
        },
      },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/cadences/:id" element={<CadenceDetail />} />
      </Routes>,
      '/cadences/cad-2',
    );
    expect((await screen.findByTestId('cadence-in-window-value')).textContent).toContain('a host has no window');
    expect(screen.queryByTestId('cadence-in-window-toggle')).not.toBeInTheDocument();
  });
});
