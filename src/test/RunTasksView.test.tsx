import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { RunTasks } from '../pages/incarnations/RunTasks';
import type { RunTaskView } from '../api/keeper';

// Схема-2 master-detail (NIM-37): чистый рендерер из RunTaskView[] (join сервера).
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
        // output = register_data (структура, НЕ строка) — реальный контракт S1a.
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

describe('RunTasks (Схема-2 master-detail, NIM-37)', () => {
  it('рендерит список всех задач + панель деталей; дефолт-выбор = упавшая задача с error', () => {
    renderWithProviders(<RunTasks tasks={TASKS} />, '/');

    // Список: обе задачи как строки-опции.
    expect(screen.getByTestId('run-task-item-0')).toBeInTheDocument();
    expect(screen.getByTestId('run-task-item-1')).toBeInTheDocument();
    expect(screen.getByTestId('run-task-item-0')).toHaveTextContent('Install redis package');

    // Дефолт-выбор — первая задача с упавшим хостом (Configure sentinel).
    const detail = screen.getByTestId('run-task-detail');
    expect(within(detail).getByText('Configure sentinel')).toBeInTheDocument();
    // Упавший хост показывает текст ошибки.
    expect(screen.getByTestId('run-task-error-redis-3.local')).toHaveTextContent("undefined variable 'quorum'");
    // Статусы задач — enum, не переводятся.
    expect(within(detail).getByText('TASK_STATUS_FAILED')).toBeInTheDocument();
  });

  it('клик по задаче меняет панель: name/module + params key/value + per-host строки', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RunTasks tasks={TASKS} />, '/');

    await user.click(screen.getByTestId('run-task-item-0'));

    const detail = screen.getByTestId('run-task-detail');
    expect(within(detail).getByText('Install redis package')).toBeInTheDocument();
    // Вход (params) — key/value.
    const params = screen.getByTestId('run-task-params');
    expect(within(params).getByText('name')).toBeInTheDocument();
    expect(within(params).getByText('redis')).toBeInTheDocument();
    expect(within(params).getByText('version')).toBeInTheDocument();
    expect(within(params).getByText('7.2.4')).toBeInTheDocument();
    // Per-host строки выбранной задачи.
    expect(screen.getByTestId('run-task-host-redis-1.local')).toBeInTheDocument();
    expect(screen.getByTestId('run-task-host-redis-2.local')).toBeInTheDocument();
  });

  it('no_log-задача: вход + per-host output + error.message скрыты (утечки нет), code/module видны', () => {
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

    // Вход скрыт, значение секрета не утекает в params-блок.
    expect(screen.getByTestId('run-task-params')).toHaveTextContent('скрыто (no_log)');
    expect(screen.queryByText('db_password')).not.toBeInTheDocument();

    // Per-host output скрыт для обоих хостов; register_data/stderr не в DOM.
    expect(screen.getByTestId('run-task-output-h1.local')).toHaveTextContent('скрыто (no_log)');
    expect(screen.getByTestId('run-task-output-h2.local')).toHaveTextContent('скрыто (no_log)');
    expect(screen.queryByText(/SUPERSECRET/)).not.toBeInTheDocument();
    expect(screen.queryByText(/LEAKED-STDERR/)).not.toBeInTheDocument();

    // Error: code + module видны, message (может нести секрет) — нет.
    const err = screen.getByTestId('run-task-error-h2.local');
    expect(err).toHaveTextContent('render_failed');
    expect(err).toHaveTextContent('core.secret.written');
    expect(screen.queryByText(/hunter2/)).not.toBeInTheDocument();
  });

  it('output-объект: per-host output рендерится как key→value (exit_code виден), пустые поля скрыты', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RunTasks tasks={TASKS} />, '/');

    // Задача 0 (Install redis) — не дефолт (дефолт = упавшая задача), кликаем.
    await user.click(screen.getByTestId('run-task-item-0'));

    const out = screen.getByTestId('run-task-output-redis-1.local');
    expect(out).toHaveTextContent('exit_code');
    expect(out).toHaveTextContent('changed');
    expect(out).toHaveTextContent('installed redis-7.2.4');
    // stderr:'' — пустое поле не рендерится (нет ключа stderr).
    expect(within(out).queryByText('stderr')).not.toBeInTheDocument();
  });

  it('задача без hosts (null) не роняет рендер', () => {
    const noHosts: RunTaskView[] = [
      { plan_index: 0, passage: 0, name: 'No hosts task', module: 'core.noop', no_log: false, hosts: null },
    ];
    renderWithProviders(<RunTasks tasks={noHosts} />, '/');
    expect(screen.getByTestId('run-task-detail')).toBeInTheDocument();
    expect(screen.getByTestId('run-task-item-0')).toHaveTextContent('No hosts task');
  });

  it('задача без params → «нет данных»', () => {
    const noParams: RunTaskView[] = [
      { plan_index: 0, passage: 0, name: 'Noop', module: 'core.noop', no_log: false, hosts: [{ sid: 'h1.local', status: 'TASK_STATUS_OK' }] },
    ];
    renderWithProviders(<RunTasks tasks={noParams} />, '/');
    expect(screen.getByTestId('run-task-params')).toHaveTextContent('нет данных');
  });

  it('пустой список задач → empty-state', () => {
    renderWithProviders(<RunTasks tasks={[]} />, '/');
    expect(screen.getByTestId('run-tasks-empty')).toBeInTheDocument();
  });
});
