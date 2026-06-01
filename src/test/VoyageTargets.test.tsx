import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { VoyageDetail } from '../pages/voyages/VoyageDetail';
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

/** barrier-режим: 2 батча с разными batch_index */
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

/** window-режим: все target с batch_index=0 */
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

describe('VoyageTargets (через VoyageDetail)', () => {
  beforeEach(() => {
    tokenStore.clear();
    // @ts-expect-error — EventSource нет в jsdom.
    globalThis.EventSource = class {
      readyState = 0;
      close() { /* noop */ }
      static OPEN = 1;
      static CONNECTING = 0;
      static CLOSED = 2;
    };
  });

  it('barrier-режим: 2 батча → 2 заголовка групп, targets распределены правильно', async () => {
    // ВАЖНО: /targets должен идти ДО /voyages/{id} — fetchMock матчит по startsWith.
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: TARGETS_BARRIER },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: VOYAGE_BASE },
    ]);

    renderVoyage(VOYAGE_ID);

    // Ждём загрузки voyage
    await waitFor(() => {
      expect(screen.getByText('succeeded')).toBeInTheDocument();
    });

    // Два заголовка батчей
    await waitFor(() => {
      expect(screen.getByTestId('batch-heading-0')).toBeInTheDocument();
      expect(screen.getByTestId('batch-heading-1')).toBeInTheDocument();
    });

    // pg-prod-1 в батче 0
    expect(screen.getByText('pg-prod-1')).toBeInTheDocument();

    // pg-prod-2 и pg-prod-3 в батче 1
    expect(screen.getByText('pg-prod-2')).toBeInTheDocument();
    expect(screen.getByText('pg-prod-3')).toBeInTheDocument();

    // Статусы отображаются как бейджи
    const allSucceeded = screen.getAllByText('succeeded');
    expect(allSucceeded.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('cancelled')).toBeInTheDocument();
  });

  it('window-режим: все batch_index=0 → ровно 1 группа', async () => {
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

    // Ровно один batch-heading (нет batch-heading-1)
    expect(screen.queryByTestId('batch-heading-1')).toBeNull();

    // Все три target видны
    expect(screen.getByText('redis-a')).toBeInTheDocument();
    expect(screen.getByText('redis-b')).toBeInTheDocument();
    expect(screen.getByText('redis-c')).toBeInTheDocument();

    // running-статус отображается
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('пустой targets-список → empty-сообщение', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: { voyage_id: VOYAGE_ID, targets: [] } },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: VOYAGE_BASE },
    ]);

    renderVoyage(VOYAGE_ID);

    await waitFor(() => {
      expect(screen.getByText('succeeded')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText(/Targets ещё не появились/)).toBeInTheDocument();
    });
  });
});
