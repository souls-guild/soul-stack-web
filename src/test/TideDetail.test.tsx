import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { TideDetail } from '../pages/tides/TideDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const TIDE_ID = '01HZAA0000000000000000000T';

const SAMPLE_TIDE = {
  tide_id: TIDE_ID,
  incarnation_name: 'redis-prod-eu',
  scenario_name: 'rolling-restart',
  status: 'partial_failed',
  total_surges: 3,
  current_surge_index: 3,
  surge_size: 10,
  scope_size: 30,
  on_surge_failure: 'continue',
  attempt: 1,
  started_by_aid: 'archon-alice',
  started_at: '2026-05-27T12:00:00Z',
  finished_at: '2026-05-27T12:10:00Z',
  summary: {
    surges: [
      {
        surge_index: 1,
        apply_id: '01HZAA0000000000000000000A',
        terminal: 'success',
        started_at: '2026-05-27T12:00:00Z',
        finished_at: '2026-05-27T12:03:00Z',
      },
      {
        surge_index: 2,
        apply_id: '01HZAA0000000000000000000B',
        terminal: 'failed',
        started_at: '2026-05-27T12:03:00Z',
        finished_at: '2026-05-27T12:06:00Z',
        failed_souls: 2,
      },
      {
        surge_index: 3,
        apply_id: '01HZAA0000000000000000000C',
        terminal: 'success',
        started_at: '2026-05-27T12:06:00Z',
        finished_at: '2026-05-27T12:10:00Z',
        state_commit_error: 'incarnation locked by parallel scenario',
      },
    ],
  },
};

function renderAt(path: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/tides/:id" element={<TideDetail />} />
    </Routes>,
    path,
  );
}

describe('TideDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит meta + surge timeline', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/tides/${TIDE_ID}`, body: SAMPLE_TIDE },
    ]);
    renderAt(`/tides/${TIDE_ID}`);
    await waitFor(() => {
      expect(screen.getByText('partial_failed')).toBeInTheDocument();
    });
    expect(screen.getByText('rolling-restart')).toBeInTheDocument();
    // три surge-строки
    expect(screen.getByText(/Surge #1/)).toBeInTheDocument();
    expect(screen.getByText(/Surge #2/)).toBeInTheDocument();
    expect(screen.getByText(/Surge #3/)).toBeInTheDocument();
    // state_commit_error alert
    expect(screen.getByText(/state_commit_error: incarnation locked/)).toBeInTheDocument();
    // progress 3/3 — заголовок секции
    expect(screen.getByText(/Прогресс: Surge 3 \/ 3/)).toBeInTheDocument();
  });
});
