import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { RunDetail } from '../pages/incarnations/RunDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const APPLY_ID = '01RUN00000000000000000001';

describe('RunDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит успешный прогон: scenario + per-host статусы, без блока упавшей задачи', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: `/v1/incarnations/redis-prod/runs/${APPLY_ID}`,
        body: {
          apply_id: APPLY_ID,
          scenario: 'create',
          status: 'success',
          started_at: '2026-06-30T10:00:00Z',
          finished_at: '2026-06-30T10:05:00Z',
          started_by_aid: 'archon-alice',
          hosts: [
            { sid: 'host-a.local', status: 'success', passage: 0, attempt: 1, cancel_requested: false },
            { sid: 'host-b.local', status: 'success', passage: 0, attempt: 1, cancel_requested: false },
          ],
        },
      },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name/runs/:applyId" element={<RunDetail />} />
      </Routes>,
      `/incarnations/redis-prod/runs/${APPLY_ID}`,
    );

    await waitFor(() => {
      expect(screen.getAllByText(APPLY_ID).length).toBeGreaterThan(0);
    });
    expect(screen.getByText('create')).toBeInTheDocument();
    expect(screen.getByText('host-a.local')).toBeInTheDocument();
    expect(screen.getByText('host-b.local')).toBeInTheDocument();
    // Successful run -- no "Failed task" section.
    expect(screen.queryByText('Упавшая задача')).not.toBeInTheDocument();
  });

  it('рендерит failed-прогон с блоком упавшей задачи (task_idx + error_summary)', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: `/v1/incarnations/redis-prod/runs/${APPLY_ID}`,
        body: {
          apply_id: APPLY_ID,
          scenario: 'create',
          status: 'failed',
          started_at: '2026-06-30T10:00:00Z',
          finished_at: '2026-06-30T10:05:00Z',
          hosts: [
            {
              sid: 'host-a.local',
              status: 'failed',
              passage: 0,
              attempt: 1,
              cancel_requested: false,
              failed_task_idx: 3,
              failed_plan_index: 7,
              error_summary: 'task 3 core.pkg.present: exit status 1',
            },
            { sid: 'host-b.local', status: 'success', passage: 0, attempt: 1, cancel_requested: false },
          ],
        },
      },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name/runs/:applyId" element={<RunDetail />} />
      </Routes>,
      `/incarnations/redis-prod/runs/${APPLY_ID}`,
    );

    await waitFor(() => {
      expect(screen.getByText('Упавшая задача')).toBeInTheDocument();
    });
    expect(screen.getByText('task_idx: 3')).toBeInTheDocument();
    expect(screen.getByText('plan_index: 7')).toBeInTheDocument();
    expect(screen.getByText('task 3 core.pkg.present: exit status 1')).toBeInTheDocument();
  });

  it('keeper-side задача (sid="keeper") — бейдж без ссылки на /souls, реальный soul остаётся кликабельным', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: `/v1/incarnations/redis-prod/runs/${APPLY_ID}`,
        body: {
          apply_id: APPLY_ID,
          scenario: 'create',
          status: 'failed',
          started_at: '2026-06-30T10:00:00Z',
          hosts: [
            {
              sid: 'keeper',
              status: 'failed',
              passage: 0,
              attempt: 1,
              cancel_requested: false,
              error_summary: 'core.cloud.created: driver error',
            },
            { sid: 'host-a.local', status: 'success', passage: 0, attempt: 1, cancel_requested: false },
          ],
        },
      },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name/runs/:applyId" element={<RunDetail />} />
      </Routes>,
      `/incarnations/redis-prod/runs/${APPLY_ID}`,
    );

    await waitFor(() => {
      expect(screen.getAllByText('keeper').length).toBeGreaterThan(0);
    });
    // sid="keeper" is not clickable as a soul -- no link to /souls/keeper.
    expect(screen.queryByRole('link', { name: /^keeper$/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('keeper-side').length).toBeGreaterThan(0);
    // A real soul remains a link as before.
    const soulLink = screen.getByRole('link', { name: 'host-a.local' });
    expect(soulLink).toHaveAttribute('href', '/souls/host-a.local');
  });

  it('sentinel-прогон (sid="__run__") — бейдж без ссылки на /souls (NIM-36)', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: `/v1/incarnations/redis-prod/runs/${APPLY_ID}`,
        body: {
          apply_id: APPLY_ID,
          scenario: 'create',
          status: 'failed',
          started_at: '2026-06-30T10:00:00Z',
          hosts: [
            {
              sid: '__run__',
              status: 'failed',
              passage: 0,
              attempt: 1,
              cancel_requested: false,
              error_summary: 'no_hosts',
            },
          ],
        },
      },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name/runs/:applyId" element={<RunDetail />} />
      </Routes>,
      `/incarnations/redis-prod/runs/${APPLY_ID}`,
    );

    await waitFor(() => {
      expect(screen.getAllByText('__run__').length).toBeGreaterThan(0);
    });
    // sid="__run__" is not clickable as a soul -- no link to /souls/__run__.
    expect(screen.queryByRole('link', { name: '__run__' })).not.toBeInTheDocument();
    expect(screen.getAllByText('no host').length).toBeGreaterThan(0);
  });

  it('404 на GET runDetail — graceful error-state, не крашится', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: `/v1/incarnations/redis-prod/runs/${APPLY_ID}`,
        status: 404,
        body: { title: 'not found', detail: 'run not found' },
      },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name/runs/:applyId" element={<RunDetail />} />
      </Routes>,
      `/incarnations/redis-prod/runs/${APPLY_ID}`,
    );

    await waitFor(() => {
      expect(screen.getByText(/404/)).toBeInTheDocument();
    });
  });
});
