import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { VoyageDetail } from '../pages/voyages/VoyageDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const VOYAGE_ID = '01VAGE0000000000000000001';

const SAMPLE_VOYAGE_SCENARIO = {
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
  target: { incarnations: ['redis-prod', 'redis-stage'] },
  summary: { total: 3, succeeded: 3, failed: 0, cancelled: 0 },
};

const SAMPLE_VOYAGE_COMMAND = {
  voyage_id: '01VCMD0000000000000000002',
  kind: 'command',
  module: 'core.cmd.shell',
  status: 'running',
  scope_size: 2,
  concurrency: 10,
  dry_run: false,
  total_batches: 1,
  current_batch_index: 0,
  attempt: 1,
  started_by_aid: 'archon-bob',
  created_at: '2026-05-29T11:00:00Z',
  started_at: '2026-05-29T11:00:01Z',
  target: { sids: ['host-a.example.com', 'host-b.example.com'] },
};

describe('VoyageDetail', () => {
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

  it('рендерит scenario-voyage с метаданными и summary', async () => {
    // ВАЖНО: /targets должен идти ДО /voyages/{id} — fetchMock матчит по startsWith.
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: { voyage_id: VOYAGE_ID, targets: [] } },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: SAMPLE_VOYAGE_SCENARIO },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/voyages/:id" element={<VoyageDetail />} />
      </Routes>,
      `/voyages/${VOYAGE_ID}`,
    );
    await waitFor(() => {
      expect(screen.getByText('succeeded')).toBeInTheDocument();
    });
    expect(screen.getByText('rolling-restart')).toBeInTheDocument();
    expect(screen.getByText('archon-alice')).toBeInTheDocument();
    // Incarnation-ссылки.
    expect(screen.getByRole('link', { name: 'redis-prod' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'redis-stage' })).toBeInTheDocument();
    // Summary counts.
    expect(screen.getByTestId('voyage-summary-counts')).toBeInTheDocument();
    expect(screen.getByTestId('voyage-summary-counts').textContent).toContain('succeeded: 3');
  });

  it('рендерит command-voyage с target.sids', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/voyages/01VCMD0000000000000000002/targets', body: { voyage_id: '01VCMD0000000000000000002', targets: [] } },
      { method: 'GET', url: '/v1/voyages/01VCMD0000000000000000002', body: SAMPLE_VOYAGE_COMMAND },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/voyages/:id" element={<VoyageDetail />} />
      </Routes>,
      '/voyages/01VCMD0000000000000000002',
    );
    await waitFor(() => {
      expect(screen.getByText('running')).toBeInTheDocument();
    });
    expect(screen.getByText('core.cmd.shell')).toBeInTheDocument();
    expect(screen.getByText(/host-a\.example\.com/)).toBeInTheDocument();
    // Нет summary → pending-сообщение.
    expect(screen.getByText(/Summary появится по мере выполнения/)).toBeInTheDocument();
  });

  it('ошибка API → errorBox', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, status: 404, body: { title: 'not found' } },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/voyages/:id" element={<VoyageDetail />} />
      </Routes>,
      `/voyages/${VOYAGE_ID}`,
    );
    await waitFor(() => {
      expect(screen.getByText(/Ошибка 404/)).toBeInTheDocument();
    });
  });

  it('progress bar рассчитывается корректно', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}/targets`, body: { voyage_id: VOYAGE_ID, targets: [] } },
      { method: 'GET', url: `/v1/voyages/${VOYAGE_ID}`, body: SAMPLE_VOYAGE_SCENARIO },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/voyages/:id" element={<VoyageDetail />} />
      </Routes>,
      `/voyages/${VOYAGE_ID}`,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('progress')).toBeInTheDocument();
    });
    // 3/3 batches → 100%
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
