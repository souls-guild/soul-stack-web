import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/primitives';
import { KeeperSidCell } from '../../components/KeeperSidCell';
import { taskStatusTone } from '../../components/status';
import type { RunTaskView } from '../../api/keeper';
import styles from './RunTasks.module.css';
import common from '../common.module.css';

// Scheme-2 master-detail run task progress (NIM-37). Data is RunTaskView[] from
// /runs/{apply_id}/tasks (server joins the plan with per-host outcomes: live AND history
// in one response). The component is presentational — fetch/polling/nudge live in RunDetail.

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

// Params value for a kv-line: scalar as-is, object/array — compact JSON.
function paramValue(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
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

export function RunTasks({ tasks, live = false }: { tasks: RunTaskView[]; live?: boolean }) {
  const { t } = useTranslation();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Default selection (until the user clicks): first task with a failed host, otherwise
  // the last one (most recent in plan order). Recomputed on live task loading —
  // the "current" task stays in focus on its own.
  const defaultTask = useMemo(() => {
    const failed = tasks.find((tk) => (tk.hosts ?? []).some((h) => taskStatusTone(h.status) === 'danger'));
    return failed ?? tasks[tasks.length - 1];
  }, [tasks]);

  const current = tasks.find((tk) => taskKey(tk) === selectedKey) ?? defaultTask;

  if (tasks.length === 0) {
    return (
      <section className={common.section} aria-label="Task timeline" data-testid="run-task-timeline">
        <h2 className={common.sectionTitle}>{t('runhistory:runTasksTitle')}</h2>
        <div className={common.empty} data-testid="run-tasks-empty">
          {t('runhistory:runTasksEmpty')}
        </div>
      </section>
    );
  }

  return (
    <section className={common.section} aria-label="Task timeline" data-testid="run-task-timeline">
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

      <div className={styles.md} data-testid="run-tasks-md">
        <div className={styles.list} role="listbox" aria-label="Tasks">
          {tasks.map((tk) => {
            const sel = current != null && taskKey(tk) === taskKey(current);
            return (
              <button
                type="button"
                key={taskKey(tk)}
                role="option"
                aria-selected={sel}
                className={`${styles.row} ${sel ? styles.rowSel : ''}`}
                onClick={() => setSelectedKey(taskKey(tk))}
                data-testid={`run-task-item-${tk.plan_index}`}
              >
                <span className={styles.idx}>#{tk.plan_index}</span>
                <span className={styles.name} title={tk.name}>
                  {tk.name}
                </span>
                <span className={styles.modchip}>{tk.module}</span>
                <span className={styles.hbar} aria-hidden="true">
                  {(tk.hosts ?? []).map((h, i) => (
                    <i
                      key={`${h.sid}-${i}`}
                      style={{ background: TONE_COLOR[taskStatusTone(h.status)] }}
                      title={`${h.sid}: ${h.status}`}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>

        {current ? <TaskDetail task={current} /> : null}
      </div>
    </section>
  );
}

function TaskDetail({ task }: { task: RunTaskView }) {
  const { t } = useTranslation();
  const paramEntries = task.params ? Object.entries(task.params) : [];
  const hosts = task.hosts ?? [];

  return (
    <div className={styles.detail} data-testid="run-task-detail">
      <div className={styles.detailHead}>
        <h3 className={styles.detailTitle}>{task.name}</h3>
        <span className={styles.modchip}>{task.module}</span>
        {task.no_log ? (
          <Badge tone="muted" title={t('runhistory:runTasksNoLogHint')}>
            no_log
          </Badge>
        ) : null}
      </div>

      <div className={styles.blabel}>{t('runhistory:runTasksInputTitle')}</div>
      {task.no_log ? (
        <div className={styles.muted} data-testid="run-task-params">
          {t('runhistory:runTasksInputNoLog')}
        </div>
      ) : paramEntries.length > 0 ? (
        <div className={styles.kv} data-testid="run-task-params">
          {paramEntries.map(([k, v]) => (
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

      <div className={styles.blabel}>{t('runhistory:runTasksByHostLabel')}</div>
      <table className={styles.hostsTable}>
        <thead>
          <tr>
            <th>SID</th>
            <th>Status</th>
            <th>Output</th>
            <th>Error</th>
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
                {task.no_log ? (
                  <span className={styles.muted} data-testid={`run-task-output-${h.sid}`}>
                    {t('runhistory:runTasksInputNoLog')}
                  </span>
                ) : (
                  <OutputCell output={h.output} sid={h.sid} />
                )}
              </td>
              <td>
                {h.error ? (
                  <span
                    className={styles.errbox}
                    style={{ display: 'inline-block', margin: 0 }}
                    data-testid={`run-task-error-${h.sid}`}
                  >
                    {h.error.module ? `${h.error.module}: ` : ''}
                    {task.no_log ? h.error.code : (h.error.message ?? h.error.code)}
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
