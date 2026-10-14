import type { RunHostStatusEntry, RunTaskView } from '../../api/keeper';
import { runStatusTone, taskStatusTone } from '../../components/status';
import { isKeeperSid } from '../../components/keeperSid';

// A run's task list as the operator reads it (NIM-996). A `serial:` step the keeper
// sent in several waves is one item holding its waves in dispatch order; every other
// task stays a row. The waves are the keeper's record (`waves` on each host task of
// such a step) — nothing here infers them from timing, because a wave that never
// started leaves no result to time.

export type WaveState = 'done' | 'failed' | 'cancelled' | 'running' | 'pending' | 'not_reached';

export interface Wave {
  index: number;
  sids: string[];
  state: WaveState;
  // Hosts of the wave that failed the step: a failed or timed-out task result, or a
  // failed detail row.
  failed: number;
}

export interface WavesStep {
  kind: 'waves';
  passage: number;
  tasks: RunTaskView[];
  waves: Wave[];
  width: number;
  // Hosts with a result on the step that are in no wave: settled by the keeper
  // before the first wave, or dropped by the run earlier and recorded as skipped.
  outside: string[];
}

export type RunTaskItem = { kind: 'task'; task: RunTaskView } | WavesStep;

function wavesOf(task: RunTaskView): string[][] | null {
  const waves = task.waves;
  if (!Array.isArray(waves) || waves.length < 2) return null;
  return waves.map((sids) => sids ?? []);
}

// A host's state in a step comes from two places: its task results and its detail
// row for the step. The row is written when the host is sent, before any task
// reports, and it is the only trace of a host that failed without a task result (a
// failed send, a stream lost mid-step). The results alone would call such a host's
// wave out of reach, and a wave in flight waiting. A linear host still waiting for
// its agent's stream has no row yet: alone in its wave it reads waiting, beside a
// host already sent it reads running, until the stream comes, `soul_timeout` fails
// it, or a Cancel ends the wait — then it stays without a row.
//
// A row closed `cancelled` reads cancelled unless a host of the wave failed — a task,
// or its row. A failed row reads failed even when it carries `cancel_requested`:
// nothing on the row tells whether the Cancel caused the failure.
//
// Not told apart: once the run ended in an earlier wave, a later wave of which any
// host was still sent a rescue reads done, and its hosts that were sent nothing lose
// their `not_reached` — a rescue send leaves the same row and result as any other; a
// host whose stream wait a Cancel ended loses it the same way. Telling them apart
// needs the keeper to record where the rollout stopped.
function settle(step: WavesStep, live: boolean, rows: readonly RunHostStatusEntry[]) {
  const byHost = new Map<string, string[]>();
  for (const task of step.tasks) {
    for (const h of task.hosts ?? []) {
      const seen = byHost.get(h.sid);
      if (seen) seen.push(h.status);
      else byHost.set(h.sid, [h.status]);
    }
  }
  const rowOf = new Map<string, RunHostStatusEntry>();
  for (const row of rows) {
    if (row.passage === step.passage) rowOf.set(row.sid, row);
  }
  const inWave = new Set<string>();
  for (const wave of step.waves) {
    let reached = 0;
    let busy = 0;
    let failed = 0;
    let cancelled = 0;
    for (const sid of wave.sids) {
      inWave.add(sid);
      const statuses = byHost.get(sid) ?? [];
      const row = rowOf.get(sid);
      const tone = row ? runStatusTone(row.status) : undefined;
      if (row || statuses.length > 0) reached++;
      if (tone === 'danger' || statuses.some((s) => taskStatusTone(s) === 'danger')) failed++;
      else if (row?.status === 'cancelled') cancelled++;
      if (row ? tone === 'info' : statuses.length < step.tasks.length) busy++;
    }
    wave.failed = failed;
    if (failed > 0) wave.state = 'failed';
    else if (cancelled > 0) wave.state = 'cancelled';
    else if (reached === 0) wave.state = live ? 'pending' : 'not_reached';
    else if (live && busy > 0) wave.state = 'running';
    else wave.state = 'done';
  }
  step.outside = [...byHost.keys()].filter((sid) => !inWave.has(sid)).sort();
}

// groupRunTasks keeps plan order: a waves step stands where its first task stands.
// live — the run is still applying, so a wave no host of which was reached is waiting
// rather than out of reach. rows — the run's detail rows, one per host per step.
export function groupRunTasks(
  tasks: readonly RunTaskView[],
  live: boolean,
  rows: readonly RunHostStatusEntry[] = [],
): RunTaskItem[] {
  const out: RunTaskItem[] = [];
  const steps = new Map<number, WavesStep>();
  for (const task of tasks) {
    const waves = wavesOf(task);
    if (!waves) {
      out.push({ kind: 'task', task });
      continue;
    }
    let step = steps.get(task.passage);
    if (!step) {
      step = {
        kind: 'waves',
        passage: task.passage,
        tasks: [],
        waves: waves.map((sids, index) => ({ index, sids, state: 'pending', failed: 0 })),
        width: Math.max(...waves.map((w) => w.length)),
        outside: [],
      };
      steps.set(task.passage, step);
      out.push(step);
    }
    step.tasks.push(task);
  }
  for (const step of steps.values()) settle(step, live, rows);
  return out;
}

export type HostOutcome = 'dropped' | 'failed' | 'cancelled' | 'not_reached' | 'running' | 'success';

// Worst first: the order a host's outcome is decided in, and the order the host
// filter lists hosts in.
export const HOST_OUTCOMES: readonly HostOutcome[] = [
  'dropped',
  'failed',
  'cancelled',
  'not_reached',
  'running',
  'success',
];

export interface HostSummary {
  sid: string;
  outcome: HostOutcome;
  // The task a dropped or failed host failed at.
  planIndex?: number;
  // The wave a not-reached host was waiting in.
  wave?: { index: number; total: number };
  notices: boolean;
}

function rowOutcome(row: RunHostStatusEntry): HostOutcome {
  if (row.dropped) return 'dropped';
  switch (runStatusTone(row.status)) {
    case 'danger':
      return 'failed';
    case 'info':
      return 'running';
    default:
      return row.status === 'cancelled' ? 'cancelled' : 'success';
  }
}

// summarizeHosts gives every host of the run one outcome, from its detail rows, its
// task results and the waves it was placed in. A host waiting in a wave the run
// ended before is `not_reached` even though its earlier steps succeeded: that is
// the one fact about it the run view must not lose. The synthetic `keeper` and
// `__run__` SIDs name no host and are left out; their failures are in the failed block.
export function summarizeHosts(
  rows: readonly RunHostStatusEntry[],
  tasks: readonly RunTaskView[],
  items: readonly RunTaskItem[],
): HostSummary[] {
  const bySid = new Map<string, HostSummary>();
  const rank = (o: HostOutcome) => HOST_OUTCOMES.indexOf(o);
  const note = (sid: string, outcome: HostOutcome, planIndex?: number) => {
    if (isKeeperSid(sid)) return;
    const cur = bySid.get(sid);
    if (!cur) {
      bySid.set(sid, { sid, outcome, planIndex, notices: false });
      return;
    }
    if (rank(outcome) < rank(cur.outcome)) {
      cur.outcome = outcome;
      cur.planIndex = planIndex;
      cur.wave = undefined;
    }
  };

  for (const row of rows) {
    note(row.sid, rowOutcome(row), row.failed_plan_index ?? undefined);
    const s = bySid.get(row.sid);
    if (s && (row.notices ?? []).length > 0) s.notices = true;
  }
  for (const task of tasks) {
    for (const h of task.hosts ?? []) {
      note(h.sid, taskStatusTone(h.status) === 'danger' ? 'failed' : 'success', task.plan_index);
    }
  }
  for (const item of items) {
    if (item.kind !== 'waves') continue;
    for (const wave of item.waves) {
      if (wave.state !== 'not_reached') continue;
      for (const sid of wave.sids) {
        note(sid, 'not_reached');
        const s = bySid.get(sid);
        if (s?.outcome === 'not_reached' && !s.wave) s.wave = { index: wave.index, total: item.waves.length };
      }
    }
  }
  return [...bySid.values()].sort(
    (a, b) => rank(a.outcome) - rank(b.outcome) || (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0),
  );
}

// waveOfHost — the wave of a waves step that holds sid, if any.
export function waveOfHost(step: WavesStep, sid: string): Wave | undefined {
  return step.waves.find((w) => w.sids.includes(sid));
}

// foldWaves decides which waves of a long rollout are drawn and which collapse into
// one line: the first and the last, every failed or running wave and the one after
// it — where the rollout stopped — and `keep`, the wave of the selected row, so the
// row the panel shows never folds away. Runs of hidden waves fold by state.
export const FOLD_ABOVE = 6;

export type WaveRow = { kind: 'wave'; wave: Wave } | { kind: 'fold'; state: WaveState; waves: Wave[] };

export function foldWaves(waves: readonly Wave[], keep?: number): WaveRow[] {
  if (waves.length <= FOLD_ABOVE) return waves.map((wave) => ({ kind: 'wave', wave }));
  const shown = new Set<number>([0, waves.length - 1]);
  if (keep != null) shown.add(keep);
  waves.forEach((w, i) => {
    if (w.state === 'failed' || w.state === 'running') {
      shown.add(i);
      shown.add(i + 1);
    }
  });
  const out: WaveRow[] = [];
  for (const wave of waves) {
    if (shown.has(wave.index)) {
      out.push({ kind: 'wave', wave });
      continue;
    }
    const last = out[out.length - 1];
    if (last?.kind === 'fold' && last.state === wave.state) last.waves.push(wave);
    else out.push({ kind: 'fold', state: wave.state, waves: [wave] });
  }
  return out.map((row) => (row.kind === 'fold' && row.waves.length === 1 ? { kind: 'wave', wave: row.waves[0] } : row));
}
