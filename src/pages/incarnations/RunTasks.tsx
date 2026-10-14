import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Badge } from '../../components/primitives';
import { KeeperSidCell } from '../../components/KeeperSidCell';
import { taskStatusTone } from '../../components/status';
import type { RunFailure, RunHostStatusEntry, RunTaskView } from '../../api/keeper';
import { ParamsByHostPanel, type HostFilter } from './RunTaskParamsByHost';
import { paramValue } from './runTaskParams';
import {
  HOST_OUTCOMES,
  foldWaves,
  groupRunTasks,
  summarizeHosts,
  waveOfHost,
  type HostOutcome,
  type HostSummary,
  type Wave,
  type WaveRow,
  type WaveState,
  type WavesStep,
} from './runWaves';
import styles from './RunTasks.module.css';
import common from '../common.module.css';

// Scheme-2 master-detail run task progress (NIM-37). Data is RunTaskView[] from
// /runs/{apply_id}/tasks (server joins the plan with per-host outcomes: live AND history
// in one response). The component is presentational — fetch/polling/nudge live in RunDetail.
// A `serial:` step sent in several waves is drawn wave by wave (NIM-996), and the host
// filter above the list stands in for the per-host table the run page no longer has
// (NIM-988).

const TONE_COLOR: Record<string, string> = {
  ok: 'var(--success)',
  warn: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  muted: 'var(--border-strong)',
};

function taskKey(t: RunTaskView): string {
  return `${t.passage}:${t.plan_index}`;
}

// output = register_data (a structure, NOT a string): compact key->value of non-empty
// fields. Empty ('' / null / undefined) are hidden — 0 and false remain significant
// (exit_code:0, changed:false). exec: exit_code/changed/stdout|stderr; file:
// path/mode/sha256. Non-object (legacy/string) is rendered as a scalar.
function OutputCell({ output, sid }: { output: unknown; sid: string }) {
  const testid = `run-task-output-${sid}`;
  if (output == null || typeof output !== 'object') {
    const s = output == null ? '' : paramValue(output);
    return (
      <span className={styles.out} data-testid={testid}>
        {s === '' ? '—' : s}
      </span>
    );
  }
  const entries = Object.entries(output as Record<string, unknown>).filter(
    ([, v]) => v !== '' && v !== null && v !== undefined,
  );
  if (entries.length === 0) {
    return (
      <span className={styles.out} data-testid={testid}>
        —
      </span>
    );
  }
  return (
    <div className={styles.outKv} data-testid={testid}>
      {entries.map(([k, v]) => (
        <span key={k} className={styles.outPair}>
          <span className={styles.outKey}>{k}</span>
          <span className={styles.outVal}>{paramValue(v)}</span>
        </span>
      ))}
    </div>
  );
}

// A row of the list: a task, or a task within one wave of a `serial:` step.
interface Entry {
  key: string;
  task: RunTaskView;
  wave?: WaveSlice;
}

interface WaveSlice {
  index: number;
  total: number;
  sids: string[];
}

function waveKey(task: RunTaskView, wave: number): string {
  return `${taskKey(task)}@${wave}`;
}

// The hosts of a task a row stands for: the wave's, then the host filter's.
function scopedHosts(task: RunTaskView, wave: WaveSlice | undefined, host: string | null) {
  return (task.hosts ?? []).filter((h) => (!wave || wave.sids.includes(h.sid)) && (!host || h.sid === host));
}

const WAVE_TONE: Record<WaveState, 'ok' | 'danger' | 'info' | 'muted'> = {
  done: 'ok',
  failed: 'danger',
  cancelled: 'muted',
  running: 'info',
  pending: 'muted',
  not_reached: 'muted',
};

const OUTCOME_TONE: Record<HostOutcome, 'ok' | 'warn' | 'danger' | 'info' | 'muted'> = {
  dropped: 'warn',
  failed: 'danger',
  cancelled: 'muted',
  not_reached: 'muted',
  running: 'info',
  success: 'ok',
};

function outcomeLabel(t: TFunction, outcome: HostOutcome): string {
  switch (outcome) {
    case 'dropped':
      return t('runhistory:runHostDropped');
    case 'failed':
      return t('runhistory:runHostFailed');
    case 'cancelled':
      return t('runhistory:runHostCancelled');
    case 'not_reached':
      return t('runhistory:runHostNotReached');
    case 'running':
      return t('runhistory:runHostRunning');
    case 'success':
      return t('runhistory:runHostSuccess');
  }
}

function waveStateLabel(t: TFunction, wave: Wave): string {
  switch (wave.state) {
    case 'done':
      return t('runhistory:runWaveDone');
    case 'failed':
      return t('runhistory:runWaveFailed', { count: wave.failed });
    case 'cancelled':
      return t('runhistory:runWaveCancelled');
    case 'running':
      return t('runhistory:runWaveRunning');
    case 'pending':
      return t('runhistory:runWavePending');
    case 'not_reached':
      return t('runhistory:runWaveNotReached');
  }
}

function waveHostsText(t: TFunction, sids: string[]): string {
  if (sids.length <= 3) return sids.join(', ');
  return t('runhistory:runWaveHosts', { count: sids.length, first: sids[0], last: sids[sids.length - 1] });
}

type FailedTask = NonNullable<RunFailure['tasks']>[number];

// renderFailed — the task a render failure stopped the run at (NIM-1000). Its step's
// plan is never stored, so the list does not have it; it is shown in its place, marked.
export function RunTasks({
  tasks,
  live = false,
  hosts = [],
  renderFailed,
}: {
  tasks: RunTaskView[];
  live?: boolean;
  // The run's detail rows: what the host filter reads a host's outcome from.
  hosts?: RunHostStatusEntry[];
  renderFailed?: FailedTask;
}) {
  const { t } = useTranslation();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hostSid, setHostSid] = useState<string | null>(null);
  const [unfolded, setUnfolded] = useState<ReadonlySet<number>>(new Set());
  const placeholder =
    renderFailed?.index != null && !tasks.some((tk) => tk.plan_index === renderFailed.index) ? renderFailed : undefined;

  const items = useMemo(() => groupRunTasks(tasks, live, hosts), [tasks, live, hosts]);
  const summaries = useMemo(() => summarizeHosts(hosts, tasks, items), [hosts, tasks, items]);
  const taskByPlan = useMemo(() => new Map(tasks.map((tk) => [tk.plan_index, tk])), [tasks]);

  // Rows in display order, the host filter applied: a wave row exists only for the
  // host's wave.
  const entries = useMemo(() => {
    const out: Entry[] = [];
    for (const item of items) {
      if (item.kind === 'task') {
        out.push({ key: taskKey(item.task), task: item.task });
        continue;
      }
      for (const wave of item.waves) {
        if (wave.state === 'pending' || wave.state === 'not_reached') continue;
        if (hostSid && !wave.sids.includes(hostSid)) continue;
        for (const task of item.tasks) {
          out.push({
            key: waveKey(task, wave.index),
            task,
            wave: { index: wave.index, total: item.waves.length, sids: wave.sids },
          });
        }
      }
    }
    return out;
  }, [items, hostSid]);

  // Default selection (until the user clicks): the first row with a failed host,
  // otherwise the last task (most recent in plan order). Recomputed on live loading —
  // the "current" row stays in focus on its own.
  const defaultEntry = useMemo(() => {
    const failed = entries.find((e) =>
      scopedHosts(e.task, e.wave, hostSid).some((h) => taskStatusTone(h.status) === 'danger'),
    );
    if (failed) return failed;
    // Nothing failed: the last task, across every wave — narrowing to its last wave
    // would hide the hosts of the others for no reason.
    const last = entries[entries.length - 1];
    return last?.wave ? { key: taskKey(last.task), task: last.task } : last;
  }, [entries, hostSid]);

  // A grouped task's own key is reachable too: clearing the wave chip shows the task
  // across every wave.
  const plainSelected = tasks.find((tk) => taskKey(tk) === selectedKey);
  const current: Entry | undefined =
    entries.find((e) => e.key === selectedKey) ??
    (plainSelected ? { key: taskKey(plainSelected), task: plainSelected } : undefined) ??
    defaultEntry;

  if (tasks.length === 0 && !placeholder) {
    return (
      <>
        <RunHostOutcomes hosts={hosts} />
        <section className={common.section} aria-label={t('incarnations:taskTimelineAria')} data-testid="run-task-timeline">
          <h2 className={common.sectionTitle}>{t('runhistory:runTasksTitle')}</h2>
          <div className={common.empty} data-testid="run-tasks-empty">
            {t('runhistory:runTasksEmpty')}
          </div>
        </section>
      </>
    );
  }

  return (
    <section className={common.section} aria-label={t('incarnations:taskTimelineAria')} data-testid="run-task-timeline">
      <h2 className={common.sectionTitle}>
        {t('runhistory:runTasksTitle')}
        {live ? (
          <>
            {' '}
            <Badge tone="info" title={t('runhistory:runTasksLiveHint')}>
              {t('runhistory:runLiveBadge')}
            </Badge>
          </>
        ) : null}
      </h2>

      {summaries.length > 1 ? (
        <HostFilterBar
          summaries={summaries}
          taskByPlan={taskByPlan}
          value={hostSid}
          onChange={setHostSid}
        />
      ) : null}

      <div
        className={`${styles.md} ${items.some((i) => i.kind === 'waves') ? styles.mdWaves : ''}`}
        data-testid="run-tasks-md"
      >
        <div className={styles.list} role="listbox" aria-label={t('incarnations:tasksAria')}>
          {items.map((item) => {
            if (item.kind === 'task') {
              const entry: Entry = { key: taskKey(item.task), task: item.task };
              return (
                <TaskRow
                  key={entry.key}
                  entry={entry}
                  host={hostSid}
                  selected={current?.key === entry.key}
                  onSelect={setSelectedKey}
                />
              );
            }
            return (
              <WavesGroup
                key={`waves-${item.passage}`}
                step={item}
                host={hostSid}
                current={current}
                summaries={summaries}
                unfolded={unfolded.has(item.passage)}
                onUnfold={() => setUnfolded((s) => new Set(s).add(item.passage))}
                onSelect={setSelectedKey}
              />
            );
          })}
          {/* Last: every task the list has ran at an earlier step. */}
          {placeholder ? (
            <div className={`${styles.row} ${styles.rowFailed}`} data-testid={`run-task-render-failed-${placeholder.index}`}>
              <span className={styles.idx}>#{placeholder.index}</span>
              <span className={styles.name} title={placeholder.name}>
                {placeholder.name}
              </span>
              {placeholder.module ? <span className={styles.modchip}>{placeholder.module}</span> : null}
              <Badge tone="danger">{t('runhistory:runTaskRenderFailed')}</Badge>
            </div>
          ) : null}
        </div>

        {current ? (
          <TaskDetail
            key={`${current.key}|${hostSid ?? ''}`}
            task={current.task}
            wave={current.wave}
            host={hostSid}
            onClearWave={() => setSelectedKey(taskKey(current.task))}
          />
        ) : null}
      </div>
    </section>
  );
}

function TaskRow({
  entry,
  host,
  selected,
  highlighted = selected,
  onSelect,
}: {
  entry: Entry;
  host: string | null;
  selected: boolean;
  // The panel shows this row's task without being this row: a task opened across
  // every wave lights each of its wave rows, and none of them is aria-selected.
  highlighted?: boolean;
  onSelect: (key: string) => void;
}) {
  const { task, wave } = entry;
  const suffix = wave ? `-w${wave.index + 1}` : '';
  const hosts = scopedHosts(task, wave, host);
  const absent = host != null && hosts.length === 0;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`${styles.row} ${highlighted ? styles.rowSel : ''} ${absent ? styles.rowDim : ''}`}
      onClick={() => onSelect(entry.key)}
      data-testid={`run-task-item-${task.plan_index}${suffix}`}
    >
      <span className={styles.idx}>#{task.plan_index}</span>
      <span className={styles.name} title={task.id}>
        {task.id}
      </span>
      <span className={styles.modchip}>{task.module}</span>
      <span
        className={styles.hbar}
        // As many columns as bars, up to the stylesheet's six: a one-host wave row
        // must not reserve six columns of empty space and squeeze the task name out.
        style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(hosts.length, 1), 6)}, 16px)` }}
        aria-hidden="true"
        data-testid={`run-task-hostbar-${task.plan_index}${suffix}`}
      >
        {hosts.map((h, i) => (
          <i
            key={`${h.sid}-${i}`}
            style={{ background: TONE_COLOR[taskStatusTone(h.status)] }}
            title={`${h.sid}: ${h.status}`}
          />
        ))}
      </span>
    </button>
  );
}

function WavesGroup({
  step,
  host,
  current,
  summaries,
  unfolded,
  onUnfold,
  onSelect,
}: {
  step: WavesStep;
  host: string | null;
  current: Entry | undefined;
  summaries: HostSummary[];
  unfolded: boolean;
  onUnfold: () => void;
  onSelect: (key: string) => void;
}) {
  const { t } = useTranslation();
  const total = step.waves.length;
  const reached = step.waves.filter((w) => w.state !== 'pending' && w.state !== 'not_reached').length;
  const stopped = step.waves.some((w) => w.state === 'not_reached');
  const hostWave = host ? waveOfHost(step, host) : undefined;
  const rows: WaveRow[] = host
    ? hostWave
      ? [{ kind: 'wave', wave: hostWave }]
      : []
    : unfolded
      ? step.waves.map((wave) => ({ kind: 'wave', wave }))
      : foldWaves(step.waves, current?.wave && step.tasks.includes(current.task) ? current.wave.index : undefined);
  const outside = host ? step.outside.filter((sid) => sid === host) : step.outside;
  const outcomeOf = (sid: string) => summaries.find((s) => s.sid === sid)?.outcome;

  return (
    <div
      className={styles.waves}
      role="group"
      aria-label={t('runhistory:runWavesAria')}
      data-testid={`run-waves-${step.passage}`}
    >
      <div className={styles.wavesHead}>
        <Badge tone="info">{t('runhistory:runWavesBadge', { width: step.width })}</Badge>
        <span className={styles.wavesSum} data-testid={`run-waves-progress-${step.passage}`}>
          {t('runhistory:runWavesProgress', { reached, total })}
          {stopped ? ` · ${t('runhistory:runWavesStopped')}` : ''}
        </span>
      </div>

      {rows.map((row) => {
        if (row.kind === 'fold') {
          const first = row.waves[0].index + 1;
          const last = row.waves[row.waves.length - 1].index + 1;
          return (
            <button
              type="button"
              key={`fold-${first}`}
              className={styles.waveFold}
              onClick={onUnfold}
              data-testid={`run-waves-fold-${step.passage}-${first}`}
            >
              {t('runhistory:runWavesFolded', { from: first, to: last, count: row.waves.length })}
              {' · '}
              {waveStateLabel(t, row.waves[0])}
            </button>
          );
        }
        const { wave } = row;
        const slice: WaveSlice = { index: wave.index, total, sids: wave.sids };
        const open = wave.state !== 'pending' && wave.state !== 'not_reached';
        return (
          <div
            key={wave.index}
            className={`${styles.wave} ${open ? '' : styles.waveIdle}`}
            role="group"
            aria-label={`${t('runhistory:runWave', { n: wave.index + 1 })} · ${waveHostsText(t, wave.sids)} · ${waveStateLabel(t, wave)}`}
            data-testid={`run-wave-${step.passage}-${wave.index + 1}`}
            data-state={wave.state}
          >
            <div className={styles.waveHead} aria-hidden="true">
              <span className={styles.waveName}>{t('runhistory:runWave', { n: wave.index + 1 })}</span>
              <span className={styles.waveHosts} title={wave.sids.join(', ')}>
                {waveHostsText(t, wave.sids)}
              </span>
              <Badge tone={WAVE_TONE[wave.state]}>{waveStateLabel(t, wave)}</Badge>
            </div>
            {open
              ? step.tasks.map((task) => {
                  const entry: Entry = { key: waveKey(task, wave.index), task, wave: slice };
                  return (
                    <TaskRow
                      key={entry.key}
                      entry={entry}
                      host={host}
                      selected={current?.key === entry.key}
                      highlighted={
                        current != null &&
                        (current.key === entry.key || (current.wave == null && current.task === task))
                      }
                      onSelect={onSelect}
                    />
                  );
                })
              : null}
          </div>
        );
      })}

      {host && !hostWave && outside.length === 0 ? (
        <div className={styles.wavesNote} data-testid={`run-waves-absent-${step.passage}`}>
          {t('runhistory:runWavesHostAbsent')}
        </div>
      ) : null}

      {outside.length > 0 ? (
        <div className={styles.wavesOutside} data-testid={`run-waves-outside-${step.passage}`}>
          <span>{t('runhistory:runWavesOutside')}</span>
          {outside.map((sid) => {
            const outcome = outcomeOf(sid);
            return (
              <span key={sid} className={styles.outsideHost}>
                <KeeperSidCell sid={sid} />
                {outcome === 'dropped' ? <Badge tone="warn">{outcomeLabel(t, outcome)}</Badge> : null}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// RunHostOutcomes — every host with its outcome, for a run whose task list cannot
// carry the host filter: no plan (a run before NIM-37, a plan write that failed or was
// reaped) or no /tasks at all. Without it such a run would show only its failed hosts.
// Successful hosts sit behind a count: on a large fleet they are the noise.
export function RunHostOutcomes({ hosts }: { hosts: RunHostStatusEntry[] }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const summaries = useMemo(() => summarizeHosts(hosts, [], []), [hosts]);
  if (summaries.length === 0) return null;
  const shown = all ? summaries : summaries.filter((s) => s.outcome !== 'success');
  const hidden = summaries.length - shown.length;
  return (
    <section
      className={common.section}
      aria-label={t('runhistory:runHostOutcomesTitle')}
      data-testid="run-host-outcomes-section"
    >
      <h2 className={common.sectionTitle}>{t('runhistory:runHostOutcomesTitle')}</h2>
      <div className={styles.outcomeList}>
        {shown.map((s) => (
          <span key={s.sid} className={styles.outsideHost} data-testid={`run-host-outcome-${s.sid}`}>
            <KeeperSidCell sid={s.sid} />
            <Badge tone={OUTCOME_TONE[s.outcome]}>{outcomeLabel(t, s.outcome)}</Badge>
            {s.notices ? <Badge tone="warn">{t('runhistory:runHostNotices')}</Badge> : null}
          </span>
        ))}
        {hidden > 0 ? (
          <button
            type="button"
            className={styles.waveFold}
            onClick={() => setAll(true)}
            data-testid="run-host-outcomes-more"
          >
            {t('runhistory:runHostOutcomesMore', { count: hidden })}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function HostFilterBar({
  summaries,
  taskByPlan,
  value,
  onChange,
}: {
  summaries: HostSummary[];
  taskByPlan: Map<number, RunTaskView>;
  value: string | null;
  onChange: (sid: string | null) => void;
}) {
  const { t } = useTranslation();
  const counts = HOST_OUTCOMES.map((o) => [o, summaries.filter((s) => s.outcome === o).length] as const).filter(
    ([, n]) => n > 0,
  );
  const where = (s: HostSummary): string => {
    if (s.wave) return t('runhistory:runWaveOf', { n: s.wave.index + 1, total: s.wave.total });
    const task = s.planIndex != null ? taskByPlan.get(s.planIndex) : undefined;
    return task ? task.id : '';
  };
  return (
    <div className={styles.hostFilter}>
      <label className={styles.hostFilterLabel}>
        <span>{t('runhistory:runHostFilterLabel')}</span>
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          data-testid="run-host-filter"
        >
          <option value="">{t('runhistory:runHostFilterAll', { count: summaries.length })}</option>
          {summaries.map((s) => {
            const w = s.outcome === 'success' || s.outcome === 'running' ? '' : where(s);
            return (
              <option key={s.sid} value={s.sid}>
                {s.sid} — {outcomeLabel(t, s.outcome)}
                {w ? ` (${w})` : ''}
                {s.notices ? ` · ${t('runhistory:runHostNotices')}` : ''}
              </option>
            );
          })}
        </select>
      </label>
      <span className={styles.hostOutcomes} data-testid="run-host-outcomes">
        {counts.map(([o, n], i) => (
          <span key={o}>
            {i > 0 ? ' · ' : ''}
            <Badge tone={OUTCOME_TONE[o]}>{outcomeLabel(t, o)}</Badge> {n}
          </span>
        ))}
      </span>
    </div>
  );
}

function ParamsPanel({ entries }: { entries: [string, unknown][] }) {
  const { t } = useTranslation();
  return (
    <>
      <div className={styles.blabel}>{t('runhistory:runTasksInputTitle')}</div>
      {entries.length > 0 ? (
        <div className={styles.kv} data-testid="run-task-params">
          {entries.map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <span className={styles.kvKey}>{k}</span>
              <span className={styles.kvVal}>{paramValue(v)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.muted} data-testid="run-task-params">
          {t('runhistory:runTasksInputEmpty')}
        </div>
      )}
    </>
  );
}

function TaskDetail({
  task,
  wave,
  host,
  onClearWave,
}: {
  task: RunTaskView;
  wave?: WaveSlice;
  host: string | null;
  onClearWave: () => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<HostFilter | null>(null);
  const paramEntries = task.params ? Object.entries(task.params) : [];
  const allHosts = scopedHosts(task, wave, host);
  const hosts = filter ? allHosts.filter((h) => filter.sids.includes(h.sid)) : allHosts;

  return (
    <div className={styles.detail} data-testid="run-task-detail">
      <div className={styles.detailHead}>
        <h3 className={styles.detailTitle}>{task.id}</h3>
        <span className={styles.modchip}>{task.module}</span>
        {wave ? (
          <button
            type="button"
            className={styles.filterChip}
            onClick={onClearWave}
            aria-label={t('runhistory:runWaveClear')}
            data-testid="run-task-wave-chip"
          >
            {t('runhistory:runWaveOf', { n: wave.index + 1, total: wave.total })} ✕
          </button>
        ) : null}
      </div>

      {/* No masking here any more: `no_log:` was retired in favour of a module
          declaring `secret: true` on an output field, and the keeper masks the
          observable copy before it is served. What arrives is already redacted,
          so a second client-side rule could only hide non-secrets. */}
      {task.params_by_host ? (
        <ParamsByHostPanel data={task.params_by_host} onFilter={setFilter} />
      ) : (
        <ParamsPanel entries={paramEntries} />
      )}

      <div className={styles.blabel}>{t('runhistory:runTasksByHostLabel')}</div>
      {filter ? (
        <div className={styles.filterBar}>
          <button
            type="button"
            className={styles.filterChip}
            onClick={() => setFilter(null)}
            aria-label={t('runhistory:runTasksClearFilter')}
            data-testid="run-task-host-filter"
          >
            {t('runhistory:runTasksFilter', { label: filter.label })} ✕
          </button>
          <span className={styles.muted}>
            {t('runhistory:runTasksFilterCount', { shown: hosts.length, total: allHosts.length })}
          </span>
        </div>
      ) : null}
      <table className={styles.hostsTable}>
        <thead>
          <tr>
            <th>{t('common:colSid')}</th>
            <th>{t('colStatus')}</th>
            <th>{t('colOutput')}</th>
            <th>{t('colError')}</th>
          </tr>
        </thead>
        <tbody>
          {hosts.map((h) => (
            <tr key={h.sid} data-testid={`run-task-host-${h.sid}`}>
              <td>
                <KeeperSidCell sid={h.sid} />
              </td>
              <td>
                <Badge tone={taskStatusTone(h.status)}>{h.status}</Badge>
              </td>
              <td>
                <OutputCell output={h.output} sid={h.sid} />
              </td>
              <td>
                {h.error ? (
                  <span
                    className={styles.errbox}
                    style={{ display: 'inline-block', margin: 0 }}
                    data-testid={`run-task-error-${h.sid}`}
                  >
                    {h.error.module ? `${h.error.module}: ` : ''}
                    {h.error.message ?? h.error.code}
                  </span>
                ) : (
                  <span className={styles.out}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
