/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Routes, Route, matchRoutes, useLocation } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { VoyageDetail } from '../pages/voyages/VoyageDetail';
import { VoyageTargets } from '../pages/voyages/VoyageTargets';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const VOYAGE_ID = '01VTGT0000000000000000001';
const APPLY_ID = '01M4XF9CC5JYMKBFP388SE0VZV';
const ERRAND_ID = '01M4XF9ERRANDKBFP388SE0VZV';

// Read from App.tsx rather than mirrored here: a mirrored table keeps a link
// green after the route it points at is renamed or removed.
const APP_ROUTES = [
  ...readFileSync(path.resolve('src/App.tsx'), 'utf8').matchAll(/<Route\s+path=["']([^"']+)["']/g),
].map((m) => ({ path: m[1] }));

const TARGETS_ALL_KINDS = {
  voyage_id: VOYAGE_ID,
  targets: [
    { target_kind: 'incarnation', target_id: 'redis-prod', batch_index: 0, status: 'succeeded', apply_id: APPLY_ID },
    { target_kind: 'incarnation', target_id: 'redis-stage', batch_index: 0, status: 'failed' },
    { target_kind: 'sid', target_id: 'db-1', batch_index: 0, status: 'succeeded', errand_id: ERRAND_ID },
    { target_kind: 'sid', target_id: 'db-2', batch_index: 0, status: 'awaiting' },
  ],
};

function RouterLocation() {
  return <output data-testid="router-location">{useLocation().pathname}</output>;
}

// Mounted where the app mounts it, so a relative `to` resolves under the Voyage
// page here exactly as it does in production.
function renderTargetsOnVoyagePage() {
  installFetchMock([{ method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: TARGETS_ALL_KINDS }]);
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/voyages/:id" element={<VoyageTargets voyageId={VOYAGE_ID} refetchInterval={false} />} />
      </Routes>
      <RouterLocation />
    </>,
    `/voyages/${VOYAGE_ID}`,
  );
}

// Where a click takes the ROUTER, not what the href says: a bare <a> leaves the
// router where it was (jsdom does not navigate), so it lands back on /voyages/:id.
function landingOf(link: HTMLElement) {
  fireEvent.click(link);
  const hit = matchRoutes(APP_ROUTES, screen.getByTestId('router-location').textContent ?? '');
  const leaf = hit?.[hit.length - 1];
  return leaf ? { pattern: leaf.route.path, params: leaf.params } : null;
}

const VOYAGE_BASE = {
  voyage_id: VOYAGE_ID,
  kind: 'scenario',
  scenario_name: 'rolling-restart',
  status: 'succeeded',
  scope_size: 3,
  batch_size: 1,
  concurrency: 50,
  batch_mode: 'barrier',
  on_failure: 'abort',
  dry_run: false,
  total_batches: 3,
  current_batch_index: 3,
  attempt: 1,
  started_by_aid: 'archon-alice',
  created_at: '2026-05-29T10:00:00Z',
  started_at: '2026-05-29T10:00:01Z',
  finished_at: '2026-05-29T10:05:00Z',
  target: { incarnations: ['pg-prod'] },
  summary: { total: 3, succeeded: 3, failed: 0, cancelled: 0 },
};

/** barrier mode: 2 batches with different batch_index */
const TARGETS_BARRIER = {
  voyage_id: VOYAGE_ID,
  targets: [
    {
      target_kind: 'incarnation',
      target_id: 'pg-prod-1',
      batch_index: 0,
      status: 'succeeded',
      apply_id: 'apply-001',
      finished_at: '2026-05-29T10:01:00Z',
    },
    {
      target_kind: 'incarnation',
      target_id: 'pg-prod-2',
      batch_index: 1,
      status: 'failed',
      apply_id: 'apply-002',
      finished_at: '2026-05-29T10:03:00Z',
    },
    {
      target_kind: 'incarnation',
      target_id: 'pg-prod-3',
      batch_index: 1,
      status: 'cancelled',
      finished_at: '2026-05-29T10:03:30Z',
    },
  ],
};

/** window mode: all targets with batch_index=0 */
const TARGETS_WINDOW = {
  voyage_id: VOYAGE_ID,
  targets: [
    {
      target_kind: 'incarnation',
      target_id: 'redis-a',
      batch_index: 0,
      status: 'succeeded',
      apply_id: 'apply-100',
      finished_at: '2026-05-29T10:02:00Z',
    },
    {
      target_kind: 'incarnation',
      target_id: 'redis-b',
      batch_index: 0,
      status: 'succeeded',
      apply_id: 'apply-101',
      finished_at: '2026-05-29T10:02:05Z',
    },
    {
      target_kind: 'incarnation',
      target_id: 'redis-c',
      batch_index: 0,
      status: 'running',
    },
  ],
};

function renderVoyage(voyageId: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/voyages/:id" element={<VoyageDetail />} />
    </Routes>,
    `/voyages/${voyageId}`,
  );
}

describe('VoyageTargets (via VoyageDetail)', () => {
  beforeEach(() => {
    tokenStore.clear();
    // @ts-expect-error — EventSource not present in jsdom.
    globalThis.EventSource = class {
      readyState = 0;
      close() { /* noop */ }
      static OPEN = 1;
      static CONNECTING = 0;
      static CLOSED = 2;
    };
  });

  it('barrier mode: 2 batches → 2 group headings, targets distributed correctly', async () => {
    // IMPORTANT: /targets must come BEFORE /voyages/{id} — fetchMock matches by startsWith.
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: TARGETS_BARRIER },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: VOYAGE_BASE },
    ]);

    renderVoyage(VOYAGE_ID);

    // Wait for voyage to load
    await waitFor(() => {
      expect(screen.getByText('succeeded')).toBeInTheDocument();
    });

    // Two batch headings
    await waitFor(() => {
      expect(screen.getByTestId('batch-heading-0')).toBeInTheDocument();
      expect(screen.getByTestId('batch-heading-1')).toBeInTheDocument();
    });

    // pg-prod-1 in batch 0
    expect(screen.getByText('pg-prod-1')).toBeInTheDocument();

    // pg-prod-2 and pg-prod-3 in batch 1
    expect(screen.getByText('pg-prod-2')).toBeInTheDocument();
    expect(screen.getByText('pg-prod-3')).toBeInTheDocument();

    // Statuses render as badges
    const allSucceeded = screen.getAllByText('succeeded');
    expect(allSucceeded.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('cancelled')).toBeInTheDocument();
  });

  it('window mode: all batch_index=0 → exactly 1 group', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: TARGETS_WINDOW },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: VOYAGE_BASE },
    ]);

    renderVoyage(VOYAGE_ID);

    await waitFor(() => {
      expect(screen.getByText('succeeded')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByTestId('batch-heading-0')).toBeInTheDocument();
    });

    // Exactly one batch-heading (no batch-heading-1)
    expect(screen.queryByTestId('batch-heading-1')).toBeNull();

    // All three targets are visible
    expect(screen.getByText('redis-a')).toBeInTheDocument();
    expect(screen.getByText('redis-b')).toBeInTheDocument();
    expect(screen.getByText('redis-c')).toBeInTheDocument();

    // running status renders
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('empty targets list → empty message', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: { voyage_id: VOYAGE_ID, targets: [] } },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: VOYAGE_BASE },
    ]);

    renderVoyage(VOYAGE_ID);

    await waitFor(() => {
      expect(screen.getByText('succeeded')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText(/No targets yet/)).toBeInTheDocument();
    });
  });

  it('statusFilter=succeeded → shows only succeeded targets, others hidden', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: TARGETS_BARRIER },
    ]);

    renderWithProviders(
      <VoyageTargets voyageId={VOYAGE_ID} refetchInterval={false} statusFilter="succeeded" />,
    );

    // Only the succeeded target is visible
    await waitFor(() => expect(screen.getByText('pg-prod-1')).toBeInTheDocument());

    // failed and cancelled are filtered out
    expect(screen.queryByText('pg-prod-2')).toBeNull();
    expect(screen.queryByText('pg-prod-3')).toBeNull();
  });

  // /voyages/:id exists, so a run link landing on SOME route proves nothing: an
  // apply_id is a scenario run, not a Voyage, and /voyages/<apply_id> is a 404.
  it.each([
    ['an incarnation target', 'redis-prod', APPLY_ID, { pattern: '/incarnations/:name/runs/:applyId', params: { name: 'redis-prod', applyId: APPLY_ID } }],
    ['a host target', 'db-1', ERRAND_ID, { pattern: '/errands/:id', params: { id: ERRAND_ID } }],
  ])('[guard] %s links the run it spawned, on the route that serves that run', async (_, targetId, runId, route) => {
    renderTargetsOnVoyagePage();

    const link = await screen.findByTestId(`target-run-link-${targetId}`);
    expect(link).toHaveTextContent(`${runId.slice(0, 12)}…`);
    expect(landingOf(link)).toEqual(route);
  });

  it('[guard] a target without a back-linked run has no link in its run cell', async () => {
    renderTargetsOnVoyagePage();

    await screen.findByText('redis-stage');
    for (const targetId of ['redis-stage', 'db-2']) {
      const row = screen.getByText(targetId).closest('tr') as HTMLTableRowElement;
      expect(within(row.cells[3]).queryByRole('link')).toBeNull();
    }
  });

  it.each([
    ['an incarnation target names its incarnation', 'redis-prod', { pattern: '/incarnations/:name', params: { name: 'redis-prod' } }],
    ['a host target names its Soul', 'db-1', { pattern: '/souls/:sid', params: { sid: 'db-1' } }],
  ])('[guard] %s', async (_, targetId, route) => {
    renderTargetsOnVoyagePage();

    expect(landingOf(await screen.findByRole('link', { name: targetId }))).toEqual(route);
  });

  // NIM-989 / NIM-617: a target refused before its child run existed has no back-link,
  // and its row's reason is the only place the operator learns why it failed.
  it('[GUARD] a target that did not run shows its error_code and error_message', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: `/v1/voyages/${VOYAGE_ID}/targets`,
        body: {
          voyage_id: VOYAGE_ID,
          targets: [
            {
              target_kind: 'incarnation',
              target_id: 'demo',
              status: 'failed',
              batch_index: 0,
              error_code: 'incarnation_error_locked',
              error_message: 'incarnation demo is error_locked by run 01HLOCKER',
            },
            { target_kind: 'incarnation', target_id: 'fine', status: 'succeeded', batch_index: 0, apply_id: 'apply-1' },
          ],
        },
      },
    ]);

    renderWithProviders(<VoyageTargets voyageId={VOYAGE_ID} refetchInterval={false} />);

    const reason = await screen.findByTestId('target-reason-demo');
    expect(reason).toHaveTextContent('incarnation_error_locked');
    expect(reason).toHaveTextContent('incarnation demo is error_locked by run 01HLOCKER');
    expect(screen.getByTestId('target-reason-fine')).toHaveTextContent('—');
  });

  it('statusFilter with 0 matches → "no targets with this status" message', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: TARGETS_BARRIER },
    ]);

    renderWithProviders(
      <VoyageTargets voyageId={VOYAGE_ID} refetchInterval={false} statusFilter="awaiting" />,
    );

    await waitFor(() =>
      expect(screen.getByText(/awaiting/)).toBeInTheDocument(),
    );

    // No table
    expect(screen.queryByText('pg-prod-1')).toBeNull();
  });
});
