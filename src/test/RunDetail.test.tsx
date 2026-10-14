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

  it('renders a successful run: scenario, no failed-task block, no per-host table (NIM-988)', async () => {
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
    // The per-host table is gone: under linear dispatch it was hosts x steps raw rows.
    // A host's outcome lives in the host filter of the task list.
    expect(screen.queryByTestId('run-hosts-table')).not.toBeInTheDocument();
    // Successful run -- no "Failed task" section.
    expect(screen.queryByText('Failed task')).not.toBeInTheDocument();
    // No input in the response (omitempty) -- the Input block is not rendered.
    expect(screen.queryByTestId('run-input-section')).not.toBeInTheDocument();
  });

  it('renders the Input block with masked secret and intact non-secret fields', async () => {
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
          input: {
            version: '7.2',
            db_password: '***MASKED***',
            users: [{ name: 'alice', perms: ['read', 'write'] }],
          },
          hosts: [
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

    const section = await waitFor(() => screen.getByTestId('run-input-section'));
    // Secret masked as-is (not re-masked), non-secret and nested fields intact.
    expect(section).toHaveTextContent('***MASKED***');
    expect(section).toHaveTextContent('7.2');
    expect(section).toHaveTextContent('alice');
    expect(section).toHaveTextContent('write');
  });

  it('renders a failed run with the failed-task block (task_idx + error_summary)', async () => {
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
      expect(screen.getByText('Failed task')).toBeInTheDocument();
    });
    expect(screen.getByText('task_idx: 3')).toBeInTheDocument();
    expect(screen.getByText('plan_index: 7')).toBeInTheDocument();
    expect(screen.getByText('task 3 core.pkg.present: exit status 1')).toBeInTheDocument();
  });

  // NIM-996/988: with /tasks answered, a failure is named by its task and its wave,
  // and a host the run went on without carries the "dropped" mark — the table that
  // showed raw passage/attempt numbers is gone.
  it('names the failed task and wave, marks a dropped host, shows a requested cancel', async () => {
    const waves = [['h1.local'], ['h2.local'], ['h3.local']];
    installFetchMock([
      {
        method: 'GET',
        url: `/v1/incarnations/redis-prod/runs/${APPLY_ID}/tasks`,
        body: {
          tasks: [
            { plan_index: 0, passage: 0, id: 'probe', module: 'core.exec.run', hosts: [{ sid: 'gone.local', status: 'TASK_STATUS_FAILED' }] },
            { plan_index: 1, passage: 1, id: 'upgrade', module: 'core.exec.run', waves, hosts: [] },
            { plan_index: 2, passage: 1, id: 'check', module: 'core.exec.run', waves, hosts: [{ sid: 'h2.local', status: 'TASK_STATUS_FAILED' }] },
          ],
        },
      },
      {
        method: 'GET',
        url: `/v1/incarnations/redis-prod/runs/${APPLY_ID}`,
        body: {
          apply_id: APPLY_ID,
          scenario: 'canary',
          status: 'failed',
          started_at: '2026-10-14T10:00:00Z',
          finished_at: '2026-10-14T10:05:00Z',
          hosts: [
            { sid: 'gone.local', status: 'failed', passage: 0, attempt: 0, cancel_requested: true, dropped: true, failed_task_idx: 0, failed_plan_index: 0, error_summary: 'task 0 core.exec: exit 2' },
            { sid: 'h2.local', status: 'failed', passage: 1, attempt: 0, cancel_requested: false, failed_task_idx: 1, failed_plan_index: 2, error_summary: 'task 1 core.exec: exit 1' },
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

    expect(await screen.findByTestId('run-failed-task-h2.local')).toHaveTextContent('task #2 check · wave 2 of 3');
    expect(screen.getByTestId('run-failed-task-gone.local')).toHaveTextContent('task #0 probe');
    expect(screen.getByTestId('run-failed-task-gone.local')).not.toHaveTextContent('wave');
    expect(screen.getByTestId('run-failed-host-gone.local')).toHaveTextContent('dropped');
    expect(screen.getByTestId('run-failed-host-h2.local')).not.toHaveTextContent('dropped');
    expect(screen.queryByText('task_idx: 1')).not.toBeInTheDocument();
    expect(screen.getByTestId('run-status')).toHaveTextContent('failed · cancel requested');
  });

  it('keeper-side task (sid="keeper") — badge without a /souls link, real soul stays clickable', async () => {
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
            {
              sid: 'host-a.local',
              status: 'failed',
              passage: 0,
              attempt: 1,
              cancel_requested: false,
              error_summary: 'core.exec.run: exit 1',
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
      expect(screen.getAllByText('keeper').length).toBeGreaterThan(0);
    });
    // sid="keeper" is not clickable as a soul -- no link to /souls/keeper.
    expect(screen.queryByRole('link', { name: /^keeper$/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('keeper-side').length).toBeGreaterThan(0);
    // A real soul remains a link as before — in the failed block and in the host outcomes.
    for (const soulLink of screen.getAllByRole('link', { name: 'host-a.local' })) {
      expect(soulLink).toHaveAttribute('href', '/souls/host-a.local');
    }
  });

  it('sentinel run (sid="__run__") — badge without a /souls link (NIM-36)', async () => {
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

  it('404 on GET runDetail — graceful error state, does not crash', async () => {
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
