import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../i18n';
import ruRunhistory from '../../public/locales/ru/runhistory.json';
import { renderWithProviders } from './renderWithProviders';
import { RunTasks } from '../pages/incarnations/RunTasks';
import { setTimeZonePref } from '../hooks/useTimeZone';
import {
  clockInZone,
  describeTimes,
  elapsedSeconds,
  formatDuration,
  instantInZone,
  rowTimes,
  scopeSids,
} from '../pages/incarnations/runTaskTimes';
import type { RunHostStatusEntry, RunTaskView } from '../api/keeper';

// When a run's step started and how long it ran (NIM-1170): the wall clock in the
// display time zone, the duration growing while a live step runs, and a wave or a
// host narrowing the row to its own hosts.

const t = i18n.t.bind(i18n);

afterEach(() => {
  vi.useRealTimers();
});

describe('runTaskTimes', () => {
  it('draws the start in the display zone, not the browser one', () => {
    const iso = '2026-10-31T12:00:01Z';
    expect(clockInZone(iso, 'UTC')).toBe('12:00:01');
    expect(clockInZone(iso, 'Europe/Moscow')).toBe('15:00:01');
    expect(clockInZone(iso, 'America/Sao_Paulo')).toBe('09:00:01');
    expect(clockInZone('not a time', 'UTC')).toBe('');
  });

  it('draws a whole instant with its date in the display zone, which can be the next day', () => {
    const iso = '2026-10-31T22:00:01Z';
    expect(instantInZone(iso, 'UTC')).toBe('31.10.2026 22:00:01');
    expect(instantInZone(iso, 'Europe/Moscow')).toBe('01.11.2026 01:00:01');
    expect(instantInZone(iso, 'America/Sao_Paulo')).toBe('31.10.2026 19:00:01');
    // Midnight is hour 00 of the new day, never 24 of the old one.
    expect(instantInZone('2026-10-31T21:00:00Z', 'Europe/Moscow')).toBe('01.11.2026 00:00:00');
    expect(clockInZone('2026-10-31T21:00:00Z', 'Europe/Moscow')).toBe('00:00:00');
    expect(instantInZone('not a time', 'UTC')).toBe('');
  });

  it('counts whole seconds and never runs backwards', () => {
    expect(elapsedSeconds('2026-10-31T12:00:01Z', '2026-10-31T12:15:01.900Z')).toBe(900);
    expect(elapsedSeconds('2026-10-31T12:00:01Z', Date.parse('2026-10-31T12:00:00Z'))).toBe(0);
    expect(elapsedSeconds('broken', '2026-10-31T12:00:00Z')).toBeNull();
  });

  it('writes a duration with abbreviated units in both languages', () => {
    expect(formatDuration(t, 4)).toBe('4 s');
    expect(formatDuration(t, 900)).toBe('15 min 0 s');
    expect(formatDuration(t, 7384)).toBe('2 h 3 min 4 s');
    // The ru bundle is served over HTTP in the app; handed over directly here. Its
    // strings are compared through the bundle: sources carry no Cyrillic.
    i18n.addResourceBundle('ru', 'runhistory', ruRunhistory, true, true);
    const ru = i18n.getFixedT('ru');
    const fill = (tpl: string, vars: Record<string, string>) =>
      Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{{${k}}}`, v), tpl);
    const dur = fill(ruRunhistory.runStepDurMS, { m: '15', s: '0' });
    expect(formatDuration(ru, 900)).toBe(dur);
    expect(dur).not.toBe('15 min 0 s');
    expect(ruRunhistory.runStepTook).toMatch(/\{\{at\}\}.*\{\{dur\}\}/);
    expect(ru('runhistory:runStepTook', { at: '15:00:01', dur })).toBe(
      fill(ruRunhistory.runStepTook, { at: '15:00:01', dur }),
    );
  });

  it('reads the whole task from the Keeper, a wave or a host from its own hosts', () => {
    const task: RunTaskView = {
      plan_index: 1,
      passage: 1,
      id: 'upgrade',
      module: 'core.exec.run',
      started_at: '2026-10-31T12:00:00Z',
      waves: [['a'], ['b', 'c']],
      hosts: [
        { sid: 'a', status: 'TASK_STATUS_OK', started_at: '2026-10-31T12:00:00Z', finished_at: '2026-10-31T12:00:05Z' },
        { sid: 'b', status: 'TASK_STATUS_OK', started_at: '2026-10-31T12:00:06Z', finished_at: '2026-10-31T12:00:09Z' },
      ],
    };
    expect(rowTimes(task, scopeSids(undefined, null), true, false)).toEqual({
      startedAt: '2026-10-31T12:00:00Z',
      finishedAt: undefined,
    });
    expect(rowTimes(task, scopeSids({ sids: ['a'] }, null), true, false)).toEqual({
      startedAt: '2026-10-31T12:00:00Z',
      finishedAt: '2026-10-31T12:00:05Z',
    });
    // c has not reported: the second wave is still going while the run is live …
    expect(rowTimes(task, scopeSids({ sids: ['b', 'c'] }, null), true, false)).toEqual({
      startedAt: '2026-10-31T12:00:06Z',
      finishedAt: undefined,
    });
    // … and over once nothing can still be at it: the run is over, the wave has
    // ended, or the Keeper says every host it was sent to finished it.
    expect(rowTimes(task, scopeSids({ sids: ['b', 'c'] }, null), false, false).finishedAt).toBe('2026-10-31T12:00:09Z');
    expect(rowTimes(task, scopeSids({ sids: ['b', 'c'] }, null), true, true).finishedAt).toBe('2026-10-31T12:00:09Z');
    expect(
      rowTimes({ ...task, finished_at: '2026-10-31T12:00:09Z' }, scopeSids({ sids: ['b', 'c'] }, null), true, false)
        .finishedAt,
    ).toBe('2026-10-31T12:00:09Z');
    expect(rowTimes(task, scopeSids({ sids: ['b', 'c'] }, 'b'), true, false).finishedAt).toBe('2026-10-31T12:00:09Z');
  });

  it('says "took" for a finished step, "running" for a live one, the start alone otherwise', () => {
    const now = Date.parse('2026-10-31T12:03:02Z');
    const started = { startedAt: '2026-10-31T12:00:00Z' };
    expect(describeTimes(t, { ...started, finishedAt: '2026-10-31T12:15:00Z' }, 'UTC', true, now)?.phrase).toBe(
      'started 12:00:00 · took 15 min 0 s',
    );
    expect(describeTimes(t, started, 'UTC', true, now)?.phrase).toBe('started 12:00:00 · running 3 min 2 s');
    expect(describeTimes(t, started, 'UTC', false, now)).toEqual({
      duration: '',
      phrase: 'started 12:00:00',
      running: false,
    });
    expect(describeTimes(t, {}, 'UTC', true, now)).toBeNull();
  });
});

const KEEPER_HANG: RunTaskView[] = [
  {
    plan_index: 0,
    passage: 0,
    id: 'deliver soul',
    module: 'core.ssh.apply',
    started_at: '2026-10-31T12:00:01Z',
    finished_at: '2026-10-31T12:15:01Z',
    hosts: [
      {
        sid: 'keeper',
        status: 'TASK_STATUS_CHANGED',
        started_at: '2026-10-31T12:00:01Z',
        finished_at: '2026-10-31T12:15:01Z',
      },
    ],
  },
  {
    plan_index: 1,
    passage: 1,
    id: 'install',
    module: 'core.pkg.installed',
    started_at: '2026-10-31T12:15:02Z',
    hosts: [],
  },
  { plan_index: 2, passage: 2, id: 'report', module: 'core.exec.run', hosts: [] },
];

describe('RunTasks with step times (NIM-1170)', () => {
  it('shows when a step started, in the display zone, and how long it ran', async () => {
    setTimeZonePref('Europe/Moscow');
    renderWithProviders(<RunTasks tasks={KEEPER_HANG} />, '/');

    const row = screen.getByTestId('run-task-time-0');
    expect(row).toHaveTextContent('15 min 0 s');
    expect(row).toHaveAttribute('title', 'started 15:00:01 · took 15 min 0 s');
    // A step that has not started carries no time at all.
    expect(screen.queryByTestId('run-task-time-2')).toBeNull();

    await userEvent.click(screen.getByTestId('run-task-item-0'));
    expect(screen.getByTestId('run-task-detail-time')).toHaveTextContent('started 15:00:01 · took 15 min 0 s');
    expect(screen.getByTestId('run-task-host-time-keeper')).toHaveTextContent('15:00:01 · 15 min 0 s');
  });

  it('lets the duration of a running step grow while the run is live', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-10-31T12:15:12Z'));
    setTimeZonePref('UTC');
    renderWithProviders(<RunTasks tasks={KEEPER_HANG} live />, '/');

    const time = screen.getByTestId('run-task-time-1');
    expect(time).toHaveTextContent('10 s');
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByTestId('run-task-time-1')).toHaveTextContent('1 min 15 s');
    expect(screen.getByTestId('run-task-time-1')).toHaveAttribute('title', 'started 12:15:02 · running 1 min 15 s');
  });

  it('does not grow a step the run ended without finishing', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-10-31T13:00:00Z'));
    setTimeZonePref('UTC');
    renderWithProviders(<RunTasks tasks={KEEPER_HANG} />, '/');

    expect(screen.queryByTestId('run-task-time-1')).toBeNull();
  });

  it('times each wave of a serial: step by its own hosts', () => {
    setTimeZonePref('UTC');
    const tasks: RunTaskView[] = [
      {
        plan_index: 0,
        passage: 0,
        id: 'upgrade',
        module: 'core.exec.run',
        waves: [['h1'], ['h2']],
        started_at: '2026-10-31T12:00:00Z',
        finished_at: '2026-10-31T12:00:50Z',
        hosts: [
          { sid: 'h1', status: 'TASK_STATUS_OK', started_at: '2026-10-31T12:00:00Z', finished_at: '2026-10-31T12:00:20Z' },
          { sid: 'h2', status: 'TASK_STATUS_OK', started_at: '2026-10-31T12:00:30Z', finished_at: '2026-10-31T12:00:50Z' },
        ],
      },
    ];
    const rows: RunHostStatusEntry[] = [
      { sid: 'h1', status: 'success', passage: 0, attempt: 0, cancel_requested: false },
      { sid: 'h2', status: 'success', passage: 0, attempt: 0, cancel_requested: false },
    ];
    renderWithProviders(<RunTasks tasks={tasks} hosts={rows} />, '/');

    const w1 = screen.getByTestId('run-task-time-0-w1');
    const w2 = screen.getByTestId('run-task-time-0-w2');
    expect(w1).toHaveAttribute('title', 'started 12:00:00 · took 20 s');
    expect(w2).toHaveAttribute('title', 'started 12:00:30 · took 20 s');
    expect(within(screen.getByTestId('run-wave-0-2')).getByTestId('run-task-time-0-w2')).toBeInTheDocument();
  });

  // A wave that has ended, in a run still going: a host of it the task was never sent
  // to must not keep the row running.
  it('stops the clock of a wave that has ended though one of its hosts never ran the task', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-10-31T12:05:00Z'));
    setTimeZonePref('UTC');
    const tasks: RunTaskView[] = [
      {
        plan_index: 0,
        passage: 0,
        id: 'upgrade',
        module: 'core.exec.run',
        waves: [['h1', 'h3'], ['h2']],
        started_at: '2026-10-31T12:00:00Z',
        hosts: [
          { sid: 'h1', status: 'TASK_STATUS_OK', started_at: '2026-10-31T12:00:00Z', finished_at: '2026-10-31T12:00:20Z' },
        ],
      },
    ];
    const rows: RunHostStatusEntry[] = [
      { sid: 'h1', status: 'success', passage: 0, attempt: 0, cancel_requested: false },
      { sid: 'h3', status: 'success', passage: 0, attempt: 0, cancel_requested: false },
      { sid: 'h2', status: 'running', passage: 0, attempt: 0, cancel_requested: false },
    ];
    renderWithProviders(<RunTasks tasks={tasks} hosts={rows} live />, '/');

    expect(screen.getByTestId('run-task-time-0-w1')).toHaveAttribute('title', 'started 12:00:00 · took 20 s');
  });

  // A wave fails at its first failed host; another host of it can still be at the task.
  it('keeps the clock of a failed wave running while a host of it still runs', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-10-31T12:15:00Z'));
    setTimeZonePref('UTC');
    const tasks: RunTaskView[] = [
      {
        plan_index: 0,
        passage: 0,
        id: 'upgrade',
        module: 'core.exec.run',
        waves: [['h1', 'h2'], ['h3']],
        started_at: '2026-10-31T12:00:00Z',
        hosts: [
          {
            sid: 'h1',
            status: 'TASK_STATUS_FAILED',
            started_at: '2026-10-31T12:00:00Z',
            finished_at: '2026-10-31T12:00:05Z',
            error: { code: 'exec_failed', module: 'core.exec' },
          },
        ],
      },
    ];
    const rows: RunHostStatusEntry[] = [
      { sid: 'h1', status: 'failed', passage: 0, attempt: 0, cancel_requested: false },
      { sid: 'h2', status: 'running', passage: 0, attempt: 0, cancel_requested: false },
    ];
    renderWithProviders(<RunTasks tasks={tasks} hosts={rows} live />, '/');

    expect(screen.getByTestId('run-task-time-0-w1')).toHaveAttribute('title', 'started 12:00:00 · running 15 min 0 s');
  });
});
