import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { RunTasks } from '../pages/incarnations/RunTasks';
import type { RunHostStatusEntry, RunTaskView } from '../api/keeper';

// A `serial:` step in the run's task list (NIM-996) and the host filter that replaced
// the per-host table (NIM-988). The canary of the NIM-926 demo: `serial: 1` over an
// `upgrade` + `check` group, `check` failing on the second host, the third never sent.

const H1 = 'nim926-1';
const H2 = 'nim926-2';
const H3 = 'nim926-3';
const WAVES = [[H1], [H2], [H3]];

const TASKS: RunTaskView[] = [
  {
    plan_index: 0,
    passage: 0,
    id: 'probe',
    module: 'core.exec.run',
    hosts: [H1, H2, H3].map((sid) => ({ sid, status: 'TASK_STATUS_OK' })),
  },
  {
    plan_index: 1,
    passage: 1,
    id: 'upgrade',
    module: 'core.exec.run',
    waves: WAVES,
    hosts: [
      { sid: H1, status: 'TASK_STATUS_CHANGED' },
      { sid: H2, status: 'TASK_STATUS_CHANGED' },
    ],
  },
  {
    plan_index: 2,
    passage: 1,
    id: 'check',
    module: 'core.exec.run',
    waves: WAVES,
    hosts: [
      { sid: H1, status: 'TASK_STATUS_OK' },
      {
        sid: H2,
        status: 'TASK_STATUS_FAILED',
        error: { code: 'exec_failed', module: 'core.exec', message: 'exit code 1 is not accepted' },
      },
    ],
  },
  { plan_index: 3, passage: 2, id: 'report', module: 'core.exec.run', hosts: [] },
];

const ROWS: RunHostStatusEntry[] = [
  { sid: H1, status: 'success', passage: 0, attempt: 0, cancel_requested: false },
  { sid: H1, status: 'success', passage: 1, attempt: 0, cancel_requested: false },
  { sid: H2, status: 'success', passage: 0, attempt: 0, cancel_requested: false },
  { sid: H2, status: 'failed', passage: 1, attempt: 0, cancel_requested: false, failed_plan_index: 2 },
  { sid: H3, status: 'success', passage: 0, attempt: 0, cancel_requested: false },
];

const rowIds = () =>
  screen
    .getAllByRole('option')
    .filter((el) => el.tagName === 'BUTTON')
    .map((el) => el.getAttribute('data-testid'));

describe('RunTasks: a serial: step wave by wave (NIM-996)', () => {
  // The demo's complaint, as a test: the list must read upgrade@1, check@1, then
  // upgrade@2, check@2 — not "all upgrades, then all checks".
  it('lists the step task by task within each wave, in dispatch order', () => {
    renderWithProviders(<RunTasks tasks={TASKS} hosts={ROWS} />, '/');
    expect(rowIds()).toEqual([
      'run-task-item-0',
      'run-task-item-1-w1',
      'run-task-item-2-w1',
      'run-task-item-1-w2',
      'run-task-item-2-w2',
      'run-task-item-3',
    ]);
    expect(screen.getByTestId('run-waves-progress-1')).toHaveTextContent('2 of 3 waves · stopped');
  });

  it('names the host of the wave the run ended before, with no task rows under it', () => {
    renderWithProviders(<RunTasks tasks={TASKS} hosts={ROWS} />, '/');
    const third = screen.getByTestId('run-wave-1-3');
    expect(third).toHaveAttribute('data-state', 'not_reached');
    expect(third).toHaveTextContent(H3);
    expect(third).toHaveTextContent('not reached');
    expect(within(third).queryAllByRole('option')).toHaveLength(0);
  });

  it('opens on the failed task of the failed wave, narrowed to that wave; the chip widens it', async () => {
    renderWithProviders(<RunTasks tasks={TASKS} hosts={ROWS} />, '/');
    expect(screen.getByTestId('run-task-item-2-w2')).toHaveAttribute('aria-selected', 'true');
    const detail = screen.getByTestId('run-task-detail');
    expect(screen.getByTestId('run-task-wave-chip')).toHaveTextContent('wave 2 of 3');
    expect(within(detail).getByTestId(`run-task-host-${H2}`)).toBeInTheDocument();
    expect(within(detail).queryByTestId(`run-task-host-${H1}`)).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('run-task-wave-chip'));
    expect(within(screen.getByTestId('run-task-detail')).getByTestId(`run-task-host-${H1}`)).toBeInTheDocument();
    expect(screen.queryByTestId('run-task-wave-chip')).not.toBeInTheDocument();
    // A single-select list: the task across every wave is no one row, so none is
    // selected — but each of its wave rows is lit, so the list still shows what the
    // panel shows.
    const selected = screen.getAllByRole('option').filter((el) => el.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(0);
    expect(screen.getByTestId('run-task-item-2-w1').className).toMatch(/rowSel/);
    expect(screen.getByTestId('run-task-item-2-w2').className).toMatch(/rowSel/);
    expect(screen.getByTestId('run-task-item-1-w1').className).not.toMatch(/rowSel/);
  });

  // While the run applies, a host sent its wave has a running detail row before any of
  // its tasks reports; the wave must read running, not waiting.
  it('reads a wave in flight from the host rows the page passes in', () => {
    const live: RunTaskView[] = TASKS.map((t) => (t.plan_index === 1 || t.plan_index === 2 ? { ...t, hosts: [] } : t));
    const rows: RunHostStatusEntry[] = [{ sid: H1, status: 'running', passage: 1, attempt: 0, cancel_requested: false }];
    renderWithProviders(<RunTasks tasks={live} hosts={rows} live />, '/');
    expect(screen.getByTestId('run-wave-1-1')).toHaveAttribute('data-state', 'running');
    expect(screen.getByTestId('run-wave-1-2')).toHaveAttribute('data-state', 'pending');
  });

  // A long rollout folds its quiet waves; the wave of the row the panel shows must not
  // fold with them.
  it('keeps the selected row drawn when the rollout folds', async () => {
    const sids = Array.from({ length: 8 }, (_, i) => `h${i + 1}.local`);
    const waves = sids.map((sid) => [sid]);
    const tasks: RunTaskView[] = [
      {
        plan_index: 0,
        passage: 0,
        id: 'upgrade',
        module: 'core.exec.run',
        waves,
        hosts: sids.map((sid) => ({ sid, status: 'TASK_STATUS_OK' as const })),
      },
    ];
    renderWithProviders(<RunTasks tasks={tasks} />, '/');
    expect(screen.queryByTestId('run-wave-0-4'), 'a quiet middle wave folds').not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByTestId('run-host-filter'), 'h4.local');
    await userEvent.click(screen.getByTestId('run-task-item-0-w4'));
    await userEvent.selectOptions(screen.getByTestId('run-host-filter'), '');
    expect(screen.getByTestId('run-task-item-0-w4')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('run-wave-0-5'), 'its neighbours still fold').not.toBeInTheDocument();
  });

  // No plan to list (a run before NIM-37, a plan write that failed or was reaped):
  // the host filter has nothing to sit on, and the hosts must not vanish with it.
  it('lists every host with its outcome when the run has no task plan', async () => {
    renderWithProviders(<RunTasks tasks={[]} hosts={ROWS} />, '/');
    expect(screen.getByTestId(`run-host-outcome-${H2}`)).toHaveTextContent('failed');
    expect(screen.queryByTestId(`run-host-outcome-${H1}`)).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('run-host-outcomes-more'));
    expect(screen.getByTestId(`run-host-outcome-${H1}`)).toHaveTextContent('success');
    expect(screen.getByTestId('run-tasks-empty')).toBeInTheDocument();
  });

  // Nothing failed: the panel opens on the last task across every wave, not on its
  // last wave — narrowing would hide the hosts of the other waves.
  it('opens a run without failures on the last task across every wave', () => {
    const ok: RunTaskView[] = [
      {
        plan_index: 0,
        passage: 0,
        id: 'restart',
        module: 'core.exec.run',
        waves: [[H1, H2], [H3]],
        hosts: [H1, H2, H3].map((sid) => ({ sid, status: 'TASK_STATUS_CHANGED' as const })),
      },
    ];
    renderWithProviders(<RunTasks tasks={ok} />, '/');
    expect(screen.queryByTestId('run-task-wave-chip')).not.toBeInTheDocument();
    const detail = screen.getByTestId('run-task-detail');
    for (const sid of [H1, H2, H3]) expect(within(detail).getByTestId(`run-task-host-${sid}`)).toBeInTheDocument();
    expect(screen.getByTestId('run-task-item-0-w1').className).toMatch(/rowSel/);
    expect(screen.getByTestId('run-task-item-0-w2').className).toMatch(/rowSel/);
    const selected = screen.getAllByRole('option').filter((el) => el.getAttribute('aria-selected') === 'true');
    expect(selected, 'the task across every wave is no one row of a single-select list').toHaveLength(0);
  });

  it('shows a step without waves as before', () => {
    renderWithProviders(<RunTasks tasks={TASKS.map((t) => ({ ...t, waves: undefined }))} hosts={ROWS} />, '/');
    expect(screen.queryByTestId('run-waves-1')).not.toBeInTheDocument();
    expect(rowIds()).toEqual(['run-task-item-0', 'run-task-item-1', 'run-task-item-2', 'run-task-item-3']);
  });

  it('lists a dropped host outside the waves, marked', () => {
    const tasks: RunTaskView[] = TASKS.map((t) =>
      t.plan_index === 1
        ? { ...t, hosts: [...(t.hosts ?? []), { sid: 'gone.local', status: 'TASK_STATUS_SKIPPED' as const }] }
        : t,
    );
    const rows = [...ROWS, { sid: 'gone.local', status: 'failed', passage: 0, attempt: 0, cancel_requested: false, dropped: true }];
    renderWithProviders(<RunTasks tasks={tasks} hosts={rows} />, '/');
    const outside = screen.getByTestId('run-waves-outside-1');
    expect(outside).toHaveTextContent('gone.local');
    expect(outside).toHaveTextContent('dropped');
  });
});

describe('RunTasks: the host filter (NIM-988)', () => {
  it('gives each host its outcome, the worst first', () => {
    renderWithProviders(<RunTasks tasks={TASKS} hosts={ROWS} />, '/');
    const options = [...screen.getByTestId('run-host-filter').querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toEqual([
      'all hosts (3)',
      `${H2} — failed (check)`,
      `${H3} — not reached (wave 3 of 3)`,
      `${H1} — success`,
    ]);
  });

  it('narrows the list to the chosen host: its wave only, its bars only', async () => {
    renderWithProviders(<RunTasks tasks={TASKS} hosts={ROWS} />, '/');
    await userEvent.selectOptions(screen.getByTestId('run-host-filter'), H1);

    expect(rowIds()).toEqual(['run-task-item-0', 'run-task-item-1-w1', 'run-task-item-2-w1', 'run-task-item-3']);
    expect(screen.queryByTestId('run-wave-1-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('run-task-hostbar-0').querySelectorAll('i')).toHaveLength(1);
    // A task the host has no result on stays in plan order, dimmed.
    expect(screen.getByTestId('run-task-item-3').className).toMatch(/rowDim/);
    const detail = screen.getByTestId('run-task-detail');
    expect(within(detail).queryByTestId(`run-task-host-${H2}`)).not.toBeInTheDocument();
  });

  it('shows the not-reached host its wave, still without rows', async () => {
    renderWithProviders(<RunTasks tasks={TASKS} hosts={ROWS} />, '/');
    await userEvent.selectOptions(screen.getByTestId('run-host-filter'), H3);
    expect(screen.getByTestId('run-wave-1-3')).toHaveAttribute('data-state', 'not_reached');
    expect(screen.queryByTestId('run-wave-1-1')).not.toBeInTheDocument();
    expect(rowIds()).toEqual(['run-task-item-0', 'run-task-item-3']);
  });
});
