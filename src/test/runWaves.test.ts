import { describe, it, expect } from 'vitest';
import type { RunHostStatusEntry, RunTaskView } from '../api/keeper';
import { foldWaves, groupRunTasks, summarizeHosts, type Wave, type WavesStep } from '../pages/incarnations/runWaves';

// The run view's model of a `serial:` step (NIM-996). The keeper records which hosts
// each wave held, before the first wave; the view must read the rollout from that
// record alone — order as dispatched, and the hosts of a wave the run ended before
// still named.

const H1 = 'nim926-1';
const H2 = 'nim926-2';
const H3 = 'nim926-3';
const CANARY_WAVES = [[H1], [H2], [H3]];

function task(planIndex: number, passage: number, id: string, hosts: [string, string][], waves?: string[][]): RunTaskView {
  return {
    plan_index: planIndex,
    passage,
    id,
    module: 'core.exec.run',
    hosts: hosts.map(([sid, status]) => ({ sid, status })),
    ...(waves ? { waves } : {}),
  } as RunTaskView;
}

// probe (no serial:) → canary roll (serial: 1, serial_scope: block: upgrade + check),
// check fails on host 2, host 3 never sent → report (no serial:), never reached.
function canary(): RunTaskView[] {
  return [
    task(0, 0, 'probe', [[H1, 'TASK_STATUS_OK'], [H2, 'TASK_STATUS_OK'], [H3, 'TASK_STATUS_OK']]),
    task(1, 1, 'upgrade', [[H1, 'TASK_STATUS_CHANGED'], [H2, 'TASK_STATUS_CHANGED']], CANARY_WAVES),
    task(2, 1, 'check', [[H1, 'TASK_STATUS_OK'], [H2, 'TASK_STATUS_FAILED']], CANARY_WAVES),
    task(3, 2, 'report', []),
  ];
}

function row(sid: string, extra: Partial<RunHostStatusEntry> = {}): RunHostStatusEntry {
  return { sid, status: 'success', passage: 0, attempt: 0, cancel_requested: false, ...extra };
}

const states = (step: WavesStep) => step.waves.map((w) => w.state);

describe('groupRunTasks', () => {
  it('makes one waves item of a serial: step, in plan position, and leaves the rest as rows', () => {
    const items = groupRunTasks(canary(), false);
    expect(items.map((i) => (i.kind === 'task' ? i.task.id : `waves:${i.tasks.map((t) => t.id).join('+')}`))).toEqual([
      'probe',
      'waves:upgrade+check',
      'report',
    ]);
    const step = items[1] as WavesStep;
    expect(step.width).toBe(1);
    expect(step.waves.map((w) => w.sids)).toEqual(CANARY_WAVES);
    expect(states(step)).toEqual(['done', 'failed', 'not_reached']);
    expect(step.waves[1].failed).toBe(1);
  });

  // The keeper's order is the dispatch order. Re-sorting it would put a host that
  // went second before the one that went first — the very misreading NIM-996 fixes.
  it('keeps the waves in the order the keeper recorded, never re-sorted', () => {
    const waves = [[H3], [H1, H2]];
    const items = groupRunTasks([task(0, 0, 'upgrade', [[H3, 'TASK_STATUS_OK']], waves)], false);
    expect((items[0] as WavesStep).waves.map((w) => w.sids)).toEqual(waves);
  });

  it('while the run applies, a wave without results is waiting and a partial one running', () => {
    const tasks = [
      task(0, 0, 'upgrade', [[H1, 'TASK_STATUS_CHANGED'], [H2, 'TASK_STATUS_CHANGED']], [[H1, H2], [H3]]),
      task(1, 0, 'check', [[H1, 'TASK_STATUS_OK']], [[H1, H2], [H3]]),
    ];
    expect(states(groupRunTasks(tasks, true)[0] as WavesStep)).toEqual(['running', 'pending']);
    // The same results once the run is over: the second wave was never reached.
    expect(states(groupRunTasks(tasks, false)[0] as WavesStep)).toEqual(['done', 'not_reached']);
  });

  // A host is sent before any of its tasks reports: its detail row for the step is
  // the first trace of it, and for a host whose agent never answered, the only one.
  it('reads a wave from the hosts detail rows of the step too, not from task results alone', () => {
    const waves = [[H1], [H2], [H3]];
    const tasks = [task(0, 1, 'upgrade', [[H1, 'TASK_STATUS_CHANGED']], waves)];
    const live = [
      row(H1, { passage: 1 }),
      row(H2, { passage: 1, status: 'running' }),
      row(H3, { passage: 0 }), // an earlier step's row says nothing about this one
    ];
    expect(states(groupRunTasks(tasks, true, live)[0] as WavesStep)).toEqual(['done', 'running', 'pending']);

    const ended = [row(H1, { passage: 1 }), row(H2, { passage: 1, status: 'failed', error_summary: 'soul_unavailable' })];
    const step = groupRunTasks(tasks, false, ended)[0] as WavesStep;
    expect(states(step)).toEqual(['done', 'failed', 'not_reached']);
    expect(step.waves[1].failed).toBe(1);
  });

  // A Cancel turns the rows of the wave in flight `cancelled`: neither failed nor
  // running, and it must not read as a wave that went through.
  it('reads a wave a Cancel interrupted as cancelled, not done', () => {
    const waves = [[H1], [H2], [H3]];
    const tasks = [task(0, 1, 'upgrade', [[H1, 'TASK_STATUS_CHANGED']], waves)];
    const rows = [row(H1, { passage: 1 }), row(H2, { passage: 1, status: 'cancelled', cancel_requested: true })];
    expect(states(groupRunTasks(tasks, false, rows)[0] as WavesStep)).toEqual(['done', 'cancelled', 'not_reached']);
  });

  // A host can fail a task and then have its run cancelled under its onfail tasks: the
  // row closes `cancelled`, but the wave did fail, and the host filter says so too.
  it('reads a wave failed when a host failed a task, though its row closed cancelled', () => {
    const waves = [[H1], [H2]];
    const tasks = [task(0, 1, 'upgrade', [[H1, 'TASK_STATUS_OK'], [H2, 'TASK_STATUS_FAILED']], waves)];
    const rows = [row(H1, { passage: 1 }), row(H2, { passage: 1, status: 'cancelled' })];
    const step = groupRunTasks(tasks, false, rows)[0] as WavesStep;
    expect(states(step)).toEqual(['done', 'failed']);
    expect(step.waves[1].failed).toBe(1);
    expect(summarizeHosts(rows, tasks, [step]).find((s) => s.sid === H2)?.outcome).toBe('failed');
  });

  // Nothing on a failed row tells whether a Cancel caused the failure, its
  // cancel_requested flag included: it reads failed, in its wave and in the host
  // filter, with or without a plan.
  it('reads a failed row as failed whatever its cancel_requested flag', () => {
    const waves = [[H1], [H2]];
    const tasks = [task(0, 1, 'upgrade', [[H1, 'TASK_STATUS_OK']], waves)];
    const flagged = row(H2, { passage: 1, status: 'failed', cancel_requested: true });
    const step = groupRunTasks(tasks, false, [row(H1, { passage: 1 }), flagged])[0] as WavesStep;
    expect(states(step)).toEqual(['done', 'failed']);
    expect(summarizeHosts([flagged], tasks, [step]).find((s) => s.sid === H2)?.outcome).toBe('failed');
    expect(summarizeHosts([flagged], [], [])[0].outcome).toBe('failed');
  });

  it('lists a host with a result on the step but in no wave as outside the waves', () => {
    const items = groupRunTasks(
      [task(0, 0, 'upgrade', [[H1, 'TASK_STATUS_OK'], ['dropped.local', 'TASK_STATUS_SKIPPED']], [[H1], [H2]])],
      false,
    );
    expect((items[0] as WavesStep).outside).toEqual(['dropped.local']);
  });

  it('reads a task without waves, or with a lone wave, as an ordinary row', () => {
    const items = groupRunTasks([task(0, 0, 'a', [], [[H1, H2]]), task(1, 1, 'b', [])], false);
    expect(items.every((i) => i.kind === 'task')).toBe(true);
  });
});

describe('summarizeHosts', () => {
  it('gives the host of a wave the run ended before `not_reached`, though its earlier steps succeeded', () => {
    const tasks = canary();
    const rows = [row(H1), row(H1, { passage: 1 }), row(H2), row(H2, { passage: 1, status: 'failed', failed_plan_index: 2 }), row(H3)];
    const byHost = Object.fromEntries(summarizeHosts(rows, tasks, groupRunTasks(tasks, false)).map((s) => [s.sid, s]));
    expect(byHost[H3].outcome).toBe('not_reached');
    expect(byHost[H3].wave).toEqual({ index: 2, total: 3 });
    expect(byHost[H2].outcome).toBe('failed');
    expect(byHost[H2].planIndex).toBe(2);
    expect(byHost[H1].outcome).toBe('success');
  });

  it('ranks dropped over failed, lists the worst first, and leaves the synthetic SIDs out', () => {
    const rows = [
      row('b.local'),
      row('a.local', { status: 'failed', dropped: true, failed_plan_index: 0 }),
      row('c.local', { status: 'failed', failed_plan_index: 0 }),
      row('__run__', { status: 'failed' }),
      row('keeper', { status: 'failed' }),
      row('d.local', { notices: [{ code: 'param_deprecated', module: 'core.cmd', message: 'x' }] }),
    ];
    const s = summarizeHosts(rows, [], []);
    expect(s.map((h) => [h.sid, h.outcome])).toEqual([
      ['a.local', 'dropped'],
      ['c.local', 'failed'],
      ['b.local', 'success'],
      ['d.local', 'success'],
    ]);
    expect(s.find((h) => h.sid === 'd.local')?.notices).toBe(true);
  });
});

describe('foldWaves', () => {
  it('keeps short rollouts whole', () => {
    const waves: Wave[] = [0, 1, 2].map((index) => ({ index, sids: [`h${index}`], state: 'done', failed: 0 }));
    expect(foldWaves(waves).every((r) => r.kind === 'wave')).toBe(true);
  });

  // serial: 1 over 29 hosts, the second wave fails: the first, the failed one, the one
  // after it (where the rollout stopped) and the last stay drawn; the rest is one line.
  it('folds a long rollout around the failure', () => {
    const waves: Wave[] = Array.from({ length: 29 }, (_, index) => ({
      index,
      sids: [`h${index + 1}`],
      state: index === 0 ? 'done' : index === 1 ? 'failed' : 'not_reached',
      failed: index === 1 ? 1 : 0,
    }));
    const rows = foldWaves(waves).map((r) =>
      r.kind === 'wave' ? `w${r.wave.index + 1}` : `fold:${r.waves[0].index + 1}-${r.waves[r.waves.length - 1].index + 1}`,
    );
    expect(rows).toEqual(['w1', 'w2', 'w3', 'fold:4-28', 'w29']);

    // The wave of the selected row stays drawn, so the panel never shows a hidden row.
    const kept = foldWaves(waves, 14).map((r) => (r.kind === 'wave' ? `w${r.wave.index + 1}` : 'fold'));
    expect(kept).toEqual(['w1', 'w2', 'w3', 'fold', 'w15', 'fold', 'w29']);
  });
});
