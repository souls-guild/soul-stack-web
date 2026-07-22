import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { VoyageDetail } from '../pages/voyages/VoyageDetail';
import { VoyageTargets } from '../pages/voyages/VoyageTargets';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const VOYAGE_ID = '01VTGT0000000000000000001';

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

  it('[guard] apply_id renders as a link to /voyages/:apply_id when present', async () => {
    const targetsWithApplyId = {
      voyage_id: VOYAGE_ID,
      targets: [
        {
          target_kind: 'incarnation',
          target_id: 'redis-prod',
          status: 'succeeded',
          batch_index: 0,
          finished_at: '2026-06-30T10:05:00Z',
          apply_id: '01APPLYID00000000000001',
        },
        {
          target_kind: 'incarnation',
          target_id: 'redis-stage',
          status: 'failed',
          batch_index: 0,
          finished_at: '2026-06-30T10:06:00Z',
          // No apply_id -> should show "-"
        },
      ],
    };
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: targetsWithApplyId },
    ]);

    renderWithProviders(
      <VoyageTargets voyageId={VOYAGE_ID} refetchInterval={false} />,
    );

    await waitFor(() => expect(screen.getByText('redis-prod')).toBeInTheDocument());
    // Link to the voyage by apply_id
    const link = screen.getByTestId('target-apply-link-redis-prod');
    expect(link).toBeInTheDocument();
    expect((link as HTMLAnchorElement).href).toContain('/voyages/01APPLYID00000000000001');
    // No apply_id - "-"
    expect(screen.queryByTestId('target-apply-link-redis-stage')).not.toBeInTheDocument();
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
