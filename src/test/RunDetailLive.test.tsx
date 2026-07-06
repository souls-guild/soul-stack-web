import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

// Мокаем SSE-транспорт: тест руками драйвит onEvent/onError. В новой модели (NIM-37
// Схема-2) SSE — nudge: task.executed инвалидирует ['run-tasks'] → refetch /tasks.
const hoisted = vi.hoisted(() => ({ opts: null as null | Record<string, (arg: unknown) => void>, calls: 0 }));
vi.mock('../api/runEvents', () => ({
  subscribeRunEvents: (_name: string, _applyId: string, opts: Record<string, (arg: unknown) => void>) => {
    hoisted.opts = opts;
    hoisted.calls += 1;
    return Promise.resolve();
  },
}));

import { RunDetail } from '../pages/incarnations/RunDetail';

const APPLY = '01RUN00000000000000000001';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderRun() {
  renderWithProviders(
    <Routes>
      <Route path="/incarnations/:name/runs/:applyId" element={<RunDetail />} />
    </Routes>,
    `/incarnations/redis-prod/runs/${APPLY}`,
  );
}

function emit(frame: { event: string; data: string }) {
  act(() => {
    hoisted.opts?.onEvent(frame);
  });
}

describe('RunDetail Схема-2 master-detail (NIM-37)', () => {
  beforeEach(() => {
    tokenStore.clear();
    hoisted.opts = null;
    hoisted.calls = 0;
  });

  it('primary: /tasks рендерит master-detail (список + панель), audit-таблицы нет', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: `/v1/incarnations/redis-prod/runs/${APPLY}/tasks`,
        body: {
          tasks: [
            {
              plan_index: 0,
              passage: 0,
              name: 'Install redis package',
              module: 'core.pkg.installed',
              no_log: false,
              params: { name: 'redis' },
              hosts: [{ sid: 'h1.local', status: 'TASK_STATUS_CHANGED', output: { changed: true } }],
            },
          ],
        },
      },
      {
        method: 'GET',
        url: `/v1/incarnations/redis-prod/runs/${APPLY}`,
        body: {
          apply_id: APPLY,
          scenario: 'create',
          status: 'success',
          started_at: '2026-06-30T10:00:00Z',
          finished_at: '2026-06-30T10:05:00Z',
          hosts: [{ sid: 'h1.local', status: 'success', passage: 0, attempt: 1, cancel_requested: false }],
        },
      },
    ]);
    renderRun();

    await waitFor(() => expect(screen.getByTestId('run-tasks-md')).toBeInTheDocument());
    expect(screen.getByTestId('run-task-item-0')).toHaveTextContent('Install redis package');
    expect(screen.getByTestId('run-task-detail')).toBeInTheDocument();
    // Терминальный прогон → SSE не подписан.
    expect(hoisted.calls).toBe(0);
    // Fallback-таймлайн (audit) НЕ рендерится, пока /tasks доступен.
    expect(screen.queryByTestId('run-task-timeline-table')).not.toBeInTheDocument();
  });

  it('live-nudge: SSE task.executed → refetch /tasks обновляет вид', async () => {
    let tasksCall = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes(`/runs/${APPLY}/tasks`)) {
          tasksCall += 1;
          const st = tasksCall === 1 ? 'TASK_STATUS_CHANGED' : 'TASK_STATUS_FAILED';
          return json({
            tasks: [
              {
                plan_index: 0,
                passage: 0,
                name: 'Configure sentinel',
                module: 'core.file.rendered',
                no_log: false,
                params: {},
                hosts: [{ sid: 'redis-3.local', status: st }],
              },
            ],
          });
        }
        if (url.includes(`/runs/${APPLY}`)) {
          return json({
            apply_id: APPLY,
            scenario: 'create',
            status: 'applying',
            started_at: '2026-06-30T10:00:00Z',
            hosts: [{ sid: 'redis-3.local', status: 'applying', passage: 0, attempt: 1, cancel_requested: false }],
          });
        }
        return json({ items: [], offset: 0, limit: 500, total: 0 });
      }),
    );
    renderRun();

    await waitFor(() => expect(screen.getByTestId('run-task-detail')).toBeInTheDocument());
    expect(screen.getByText('TASK_STATUS_CHANGED')).toBeInTheDocument();
    // status=applying → SSE-подписка открыта.
    await waitFor(() => expect(hoisted.opts).not.toBeNull());

    emit({ event: 'task.executed', data: '{}' });

    // nudge инвалидировал ['run-tasks'] → refetch → новый статус в панели.
    await waitFor(() => expect(screen.getByText('TASK_STATUS_FAILED')).toBeInTheDocument());
    expect(tasksCall).toBeGreaterThanOrEqual(2);
  });

  it('fallback: /tasks 404 → деградация к audit-таймлайну (per-host итог остаётся)', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: `/v1/incarnations/redis-prod/runs/${APPLY}/tasks`,
        status: 404,
        body: { title: 'not found', detail: 'tasks endpoint not deployed' },
      },
      {
        method: 'GET',
        url: `/v1/incarnations/redis-prod/runs/${APPLY}`,
        body: {
          apply_id: APPLY,
          scenario: 'create',
          status: 'success',
          started_at: '2026-06-30T10:00:00Z',
          finished_at: '2026-06-30T10:05:00Z',
          hosts: [{ sid: 'h1.local', status: 'success', passage: 0, attempt: 1, cancel_requested: false }],
        },
      },
      {
        method: 'GET',
        url: '/v1/audit',
        body: {
          items: [
            {
              id: 'a1',
              type: 'task.executed',
              source: 'soul_grpc',
              correlation_id: APPLY,
              created_at: '2026-06-30T10:01:00Z',
              payload: { sid: 'h1.local', apply_id: APPLY, task_idx: 0, plan_index: 0, passage: 0, status: 'TASK_STATUS_OK' },
            },
          ],
          offset: 0,
          limit: 500,
          total: 1,
        },
      },
    ]);
    renderRun();

    // master-detail не рендерится, зато audit-таблица (fallback) и per-host итог на месте.
    await waitFor(() => expect(screen.getByTestId('run-task-row-h1.local|0|0')).toBeInTheDocument());
    expect(screen.getByText('TASK_STATUS_OK')).toBeInTheDocument();
    expect(screen.getByTestId('run-hosts-table')).toBeInTheDocument();
    expect(screen.queryByTestId('run-tasks-md')).not.toBeInTheDocument();
  });

  it('fallback + audit 403 → мягкая деградация (плашка), per-host итог остаётся', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: `/v1/incarnations/redis-prod/runs/${APPLY}/tasks`,
        status: 404,
        body: { title: 'not found' },
      },
      {
        method: 'GET',
        url: `/v1/incarnations/redis-prod/runs/${APPLY}`,
        body: {
          apply_id: APPLY,
          scenario: 'create',
          status: 'success',
          started_at: '2026-06-30T10:00:00Z',
          finished_at: '2026-06-30T10:05:00Z',
          hosts: [{ sid: 'h1.local', status: 'success', passage: 0, attempt: 1, cancel_requested: false }],
        },
      },
      { method: 'GET', url: '/v1/audit', status: 403, body: { title: 'forbidden', detail: 'audit.read required' } },
    ]);
    renderRun();

    await waitFor(() => expect(screen.getByTestId('run-tasks-degraded')).toBeInTheDocument());
    expect(screen.getByTestId('run-hosts-table')).toBeInTheDocument();
  });
});
