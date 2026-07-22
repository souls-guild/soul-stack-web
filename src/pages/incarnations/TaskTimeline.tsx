import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/primitives';
import { KeeperSidCell } from '../../components/KeeperSidCell';
import { taskStatusTone } from '../../components/status';
import { taskRowKey, type TaskRow } from './taskRow';
import styles from '../common.module.css';

// Unified per-task run renderer (NIM-37): live (SSE) and history (audit)
// arrive as normalized TaskRow and are drawn as a single table. The model and
// normalization live in ./taskRow.
export function TaskTimeline({
  rows,
  degraded = false,
  live = false,
}: {
  rows: TaskRow[];
  degraded?: boolean;
  live?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section className={styles.section} aria-label="Task timeline" data-testid="run-task-timeline">
      <h2 className={styles.sectionTitle}>
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
      {degraded ? (
        <div className={styles.empty} data-testid="run-tasks-degraded">
          {t('runhistory:runTasksAuditDegraded')}
        </div>
      ) : null}
      {rows.length === 0 ? (
        <div className={styles.empty} data-testid="run-tasks-empty">
          {t('runhistory:runTasksEmpty')}
        </div>
      ) : (
        <table className={styles.table} data-testid="run-task-timeline-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('runhistory:runColPassage')}</th>
              <th>SID</th>
              <th>Status</th>
              <th>Module</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={taskRowKey(r)} data-testid={`run-task-row-${taskRowKey(r)}`}>
                <td className="mono">
                  {r.taskIdx}
                  {r.planIndex != null && r.planIndex !== r.taskIdx ? ` (#${r.planIndex})` : ''}
                </td>
                <td className="mono">{r.passage}</td>
                <td className="mono">
                  <KeeperSidCell sid={r.sid} />
                </td>
                <td>
                  <Badge tone={taskStatusTone(r.status)}>{r.status}</Badge>
                  {r.suppressed === 'no_log' ? (
                    <>
                      {' '}
                      <Badge tone="muted" title={t('runhistory:runTasksNoLogHint')}>
                        no_log
                      </Badge>
                    </>
                  ) : null}
                </td>
                <td className="mono">{r.errorModule ?? r.errorCode ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
