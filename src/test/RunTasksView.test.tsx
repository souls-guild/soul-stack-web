import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { RunTasks } from '../pages/incarnations/RunTasks';
import type { RunTaskView } from '../api/keeper';

// Schema-2 master-detail (NIM-37): pure renderer from RunTaskView[] (server-side join).
const TASKS: RunTaskView[] = [
  {
    plan_index: 0,
    passage: 0,
    name: 'Install redis package',
    module: 'core.pkg.installed',
    no_log: false,
    params: { name: 'redis', version: '7.2.4' },
    hosts: [
      {
        sid: 'redis-1.local',
        status: 'TASK_STATUS_CHANGED',
        // output = register_data (structure, NOT a string) — actual S1a contract.
        output: { changed: true, exit_code: 0, stdout: 'installed redis-7.2.4', stderr: '' },
      },
      { sid: 'redis-2.local', status: 'TASK_STATUS_OK', output: { changed: false, exit_code: 0 } },
    ],
  },
  {
    plan_index: 1,
    passage: 0,
    name: 'Configure sentinel',
    module: 'core.file.rendered',
    no_log: false,
    params: { path: '/etc/redis/sentinel.conf' },
    hosts: [
      { sid: 'redis-1.local', status: 'TASK_STATUS_OK', output: { changed: false } },
      {
        sid: 'redis-3.local',
        status: 'TASK_STATUS_FAILED',
        error: { code: 'render_failed', module: 'core.file.rendered', message: "undefined variable 'quorum'" },
      },
    ],
  },
];

describe('RunTasks (Schema-2 master-detail, NIM-37)', () => {
  it('renders the list of all tasks + detail panel; default selection = the failed task with error', () => {
    renderWithProviders(<RunTasks tasks={TASKS} />, '/');

    // List: both tasks as string options.
    expect(screen.getByTestId('run-task-item-0')).toBeInTheDocument();
    expect(screen.getByTestId('run-task-item-1')).toBeInTheDocument();
    expect(screen.getByTestId('run-task-item-0')).toHaveTextContent('Install redis package');

    // Default selection — the first task with a failed host (Configure sentinel).
    const detail = screen.getByTestId('run-task-detail');
    expect(within(detail).getByText('Configure sentinel')).toBeInTheDocument();
    // Failed host shows the error text.
    expect(screen.getByTestId('run-task-error-redis-3.local')).toHaveTextContent("undefined variable 'quorum'");
    // Task statuses — enum, not translated.
    expect(within(detail).getByText('TASK_STATUS_FAILED')).toBeInTheDocument();
  });

  it('clicking a task swaps the panel: name/module + params key/value + per-host rows', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RunTasks tasks={TASKS} />, '/');

    await user.click(screen.getByTestId('run-task-item-0'));

    const detail = screen.getByTestId('run-task-detail');
    expect(within(detail).getByText('Install redis package')).toBeInTheDocument();
    // Input (params) — key/value.
    const params = screen.getByTestId('run-task-params');
    expect(within(params).getByText('name')).toBeInTheDocument();
    expect(within(params).getByText('redis')).toBeInTheDocument();
    expect(within(params).getByText('version')).toBeInTheDocument();
    expect(within(params).getByText('7.2.4')).toBeInTheDocument();
    // Per-host rows of the selected task.
    expect(screen.getByTestId('run-task-host-redis-1.local')).toBeInTheDocument();
    expect(screen.getByTestId('run-task-host-redis-2.local')).toBeInTheDocument();
  });

  it('no_log task: input + per-host output + error.message are hidden (no leak), code/module visible', () => {
    const noLog: RunTaskView[] = [
      {
        plan_index: 0,
        passage: 0,
        name: 'Write secret',
        module: 'core.secret.written',
        no_log: true,
        params: { key: 'db_password' },
        hosts: [
          { sid: 'h1.local', status: 'TASK_STATUS_CHANGED', output: { changed: true, stdout: 'SUPERSECRET' } },
          {
            sid: 'h2.local',
            status: 'TASK_STATUS_FAILED',
            output: { stderr: 'LEAKED-STDERR' },
            error: { code: 'render_failed', module: 'core.secret.written', message: 'secret=hunter2 leaked' },
          },
        ],
      },
    ];
    renderWithProviders(<RunTasks tasks={noLog} />, '/');

    // Input is hidden, secret value does not leak into the params block.
    expect(screen.getByTestId('run-task-params')).toHaveTextContent('hidden (no_log)');
    expect(screen.queryByText('db_password')).not.toBeInTheDocument();

    // Per-host output is hidden for both hosts; register_data/stderr not in DOM.
    expect(screen.getByTestId('run-task-output-h1.local')).toHaveTextContent('hidden (no_log)');
    expect(screen.getByTestId('run-task-output-h2.local')).toHaveTextContent('hidden (no_log)');
    expect(screen.queryByText(/SUPERSECRET/)).not.toBeInTheDocument();
    expect(screen.queryByText(/LEAKED-STDERR/)).not.toBeInTheDocument();

    // Error: code + module visible, message (may carry a secret) is hidden.
    const err = screen.getByTestId('run-task-error-h2.local');
    expect(err).toHaveTextContent('render_failed');
    expect(err).toHaveTextContent('core.secret.written');
    expect(screen.queryByText(/hunter2/)).not.toBeInTheDocument();
  });

  it('output object: per-host output renders as key→value (exit_code visible), empty fields hidden', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RunTasks tasks={TASKS} />, '/');

    // Task 0 (Install redis) — not the default (default = failed task), click it.
    await user.click(screen.getByTestId('run-task-item-0'));

    const out = screen.getByTestId('run-task-output-redis-1.local');
    expect(out).toHaveTextContent('exit_code');
    expect(out).toHaveTextContent('changed');
    expect(out).toHaveTextContent('installed redis-7.2.4');
    // stderr:'' — empty field is not rendered (no stderr key).
    expect(within(out).queryByText('stderr')).not.toBeInTheDocument();
  });

  it('task with no hosts (null) does not crash rendering', () => {
    const noHosts: RunTaskView[] = [
      { plan_index: 0, passage: 0, name: 'No hosts task', module: 'core.noop', no_log: false, hosts: null },
    ];
    renderWithProviders(<RunTasks tasks={noHosts} />, '/');
    expect(screen.getByTestId('run-task-detail')).toBeInTheDocument();
    expect(screen.getByTestId('run-task-item-0')).toHaveTextContent('No hosts task');
  });

  it('task with no params → «no data»', () => {
    const noParams: RunTaskView[] = [
      { plan_index: 0, passage: 0, name: 'Noop', module: 'core.noop', no_log: false, hosts: [{ sid: 'h1.local', status: 'TASK_STATUS_OK' }] },
    ];
    renderWithProviders(<RunTasks tasks={noParams} />, '/');
    expect(screen.getByTestId('run-task-params')).toHaveTextContent('no data');
  });

  it('empty task list → empty-state', () => {
    renderWithProviders(<RunTasks tasks={[]} />, '/');
    expect(screen.getByTestId('run-tasks-empty')).toBeInTheDocument();
  });
});
