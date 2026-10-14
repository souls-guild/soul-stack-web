import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import i18n from '../i18n';
import { renderWithProviders } from './renderWithProviders';
import { RunDetail } from '../pages/incarnations/RunDetail';
import { failureLine } from '../pages/incarnations/runFailure';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';
import type { RunFailure } from '../api/keeper';

// NIM-1000: why and where a failed run stopped.

const APPLY_ID = '01RUN00000000000000000002';
const SUMMARY =
  'render: task "reads a missing register key" (host host-a.local): render: cell "args[0]": CEL eval "register.probe.no_such_key": no such key: no_such_key';

const RENDER_FAILURE: RunFailure = {
  summary: SUMMARY,
  code: 'render_failed',
  step: 1,
  tasks: [
    { index: 1, name: 'reads a missing register key', module: 'core.exec.run', file: 'scenario/render_fail/main.yml', line: 13 },
  ],
  host: 'host-a.local',
  cell: 'args[0]',
  expression: 'register.probe.no_such_key',
  cause: 'no such key: no_such_key',
};

function run(failure: RunFailure | undefined, hosts: unknown[]) {
  return {
    apply_id: APPLY_ID,
    scenario: 'render_fail',
    status: 'failed',
    started_at: '2026-10-14T15:54:13Z',
    finished_at: '2026-10-14T15:54:13Z',
    hosts,
    ...(failure ? { failure } : {}),
  };
}

const SENTINEL = { sid: '__run__', status: 'failed', passage: 1, attempt: 0, cancel_requested: false, error_summary: 'render_failed' };
const PROBE_OK = { sid: 'host-a.local', status: 'success', passage: 0, attempt: 1, cancel_requested: false };

function renderRun(body: unknown, tasks: unknown[] = []) {
  installFetchMock([
    { method: 'GET', url: `/v1/incarnations/demo/runs/${APPLY_ID}/tasks`, body: { tasks } },
    { method: 'GET', url: `/v1/incarnations/demo/runs/${APPLY_ID}`, body },
  ]);
  renderWithProviders(
    <Routes>
      <Route path="/incarnations/:name/runs/:applyId" element={<RunDetail />} />
    </Routes>,
    `/incarnations/demo/runs/${APPLY_ID}`,
  );
}

describe('RunDetail — the run failure (NIM-1000)', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('a render failure: where (step, task, file:line, host) and what (cell, expression, cause), full text folded', async () => {
    renderRun(run(RENDER_FAILURE, [SENTINEL, PROBE_OK]), [
      { plan_index: 0, passage: 0, id: 'probe', module: 'core.exec.run', hosts: [{ sid: 'host-a.local', status: 'TASK_STATUS_OK' }] },
    ]);
    const row = await screen.findByTestId('run-failure');
    expect(within(row).getByText('render_failed')).toBeInTheDocument();
    const where = within(row).getByTestId('run-failure-where');
    expect(where).toHaveTextContent('step 1 › #1 reads a missing register key');
    expect(within(row).getByTestId('run-failure-source')).toHaveTextContent('scenario/render_fail/main.yml:13');
    expect(where).toHaveTextContent('host-a.local');
    expect(within(row).getByTestId('run-failure-cause')).toHaveTextContent(
      'args[0] · register.probe.no_such_key → no such key: no_such_key',
    );
    expect(within(row).getByTestId('run-failure-summary')).toHaveTextContent(SUMMARY);

    // The sentinel's bare code is not a second failure entry.
    const section = screen.getByTestId('run-failed-section');
    expect(within(section).queryByText('__run__')).not.toBeInTheDocument();

    // The task the render stopped at stands in the list in its place.
    const placeholder = await screen.findByTestId('run-task-render-failed-1');
    expect(placeholder).toHaveTextContent('#1');
    expect(placeholder).toHaveTextContent('reads a missing register key');
    expect(placeholder).toHaveTextContent('render failed');
  });

  it('the task list shows the failed task even when no step reached a host', async () => {
    renderRun(run({ ...RENDER_FAILURE, step: 0, tasks: [{ ...RENDER_FAILURE.tasks![0], index: 0 }] }, [{ ...SENTINEL, passage: 0 }]), []);
    expect(await screen.findByTestId('run-task-render-failed-0')).toBeInTheDocument();
    expect(screen.queryByTestId('run-tasks-empty')).not.toBeInTheDocument();
  });

  it('a withheld cause says so and shows no cause text', async () => {
    renderRun(
      run(
        {
          ...RENDER_FAILURE,
          expression: 'vars.m[input.pw]',
          cause: 'evaluation failed; the error is withheld because the expression reads a secret',
          cause_withheld: true,
        },
        [SENTINEL, PROBE_OK],
      ),
    );
    const cause = await screen.findByTestId('run-failure-cause');
    expect(cause).toHaveTextContent('vars.m[input.pw] → evaluation failed — the expression reads a secret, so the error text is withheld');
  });

  it('a run recorded before the fields existed shows its text as it is', async () => {
    renderRun(run({ summary: 'scenario: load service: clone failed' }, [{ ...SENTINEL, error_summary: 'scenario_load_failed', passage: 0 }]));
    const row = await screen.findByTestId('run-failure');
    expect(within(row).getByTestId('run-failure-summary')).toHaveTextContent('scenario: load service: clone failed');
    expect(within(row).queryByTestId('run-failure-cause')).not.toBeInTheDocument();
  });

  it('beside failed hosts the run row stays, its text folded — the abort may not be theirs', async () => {
    // A host dropped at step 1, the run aborted at step 3 for its own reason.
    renderRun(
      run({ summary: 'scenario: re-resolve roster before Passage 3: timeout', code: 'topology_failed', step: 3 }, [
        { sid: 'host-a.local', status: 'failed', passage: 1, attempt: 1, cancel_requested: false, error_summary: 'task 1 core.exec.run: exit code 1' },
      ]),
    );
    const row = await screen.findByTestId('run-failure');
    expect(within(row).getByText('topology_failed')).toBeInTheDocument();
    expect(within(row).getByTestId('run-failure-where')).toHaveTextContent('step 3');
    expect(within(row).getByText('full text')).toBeInTheDocument();
    expect(screen.getByText('task 1 core.exec.run: exit code 1')).toBeInTheDocument();
  });

  it('an applier is named with its destiny and no index of its own', async () => {
    renderRun(
      run(
        {
          ...RENDER_FAILURE,
          tasks: [
            { name: 'install', destiny: 'redis-server@v1', file: 'scenario/render_fail/main.yml', line: 4 },
            { index: 2, name: 'write config', module: 'core.file.rendered', file: 'tasks/main.yml', line: 9 },
          ],
        },
        [SENTINEL, PROBE_OK],
      ),
    );
    const where = await screen.findByTestId('run-failure-where');
    expect(where).toHaveTextContent('step 1 › install (redis-server@v1) › #2 write config');
    expect(within(where).getByTestId('run-failure-source')).toHaveTextContent('tasks/main.yml:9');
  });
});

describe('failureLine', () => {
  const t = i18n.t.bind(i18n);

  it('step · task · cause for an addressed failure', () => {
    expect(failureLine(RENDER_FAILURE, t)).toBe('step 1 · reads a missing register key · no such key: no_such_key');
  });

  it('the summary for a failure without an address', () => {
    expect(failureLine({ summary: 'incarnation "x" has no connected hosts', code: 'no_hosts' }, t)).toBe(
      'incarnation "x" has no connected hosts',
    );
  });

  it('the withheld sentence, never a cause, when the cause was withheld', () => {
    expect(failureLine({ ...RENDER_FAILURE, cause: 'evaluation failed; …', cause_withheld: true }, t)).toBe(
      'step 1 · reads a missing register key · evaluation failed — the expression reads a secret, so the error text is withheld',
    );
  });
});
