import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge } from '../../components/primitives';
import { KeeperSidCell } from '../../components/KeeperSidCell';
import { JsonViewer } from '../../components/JsonViewer';
import { runStatusTone } from '../../components/status';
import { subscribeRunEvents } from '../../api/runEvents';
import { RunTasks } from './RunTasks';
import { TaskTimeline } from './TaskTimeline';
import { normalizeAuditTaskPayload, sortTaskRows, type TaskRow } from './taskRow';
import styles from '../common.module.css';

// Run view: details of a single incarnation apply_run (create/rerun-last/operational
// scenario run). NOT Voyage (batch run across many incarnations) — apply_run
// addresses exactly one incarnation, so it gets a separate route/page.
//
// Task progress (NIM-37, Scheme-2 master-detail): primary — GET /runs/{apply_id}/tasks
// (server joins the plan with per-host outcomes, live AND history in one response). SSE
// task.executed is a nudge: invalidates ['run-tasks'] for an instant refetch.
// Graceful fallback: while backend /tasks isn't deployed (404/501) — degrade to
// the per-host summary + audit timeline (previous view).
const NON_TERMINAL = new Set(['applying']);

export function RunDetail() {
  const { t } = useTranslation();
  const { name = '', applyId = '' } = useParams<{ name: string; applyId: string }>();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['incarnation-run', name, applyId],
    queryFn: () => keeperApi.incarnations.runDetail(name, applyId),
    enabled: Boolean(name) && Boolean(applyId),
    refetchInterval: (query) => (NON_TERMINAL.has(query.state.data?.status ?? '') ? 3000 : false),
  });

  const status = q.data?.status;
  const isApplying = status === 'applying';

  // Primary: per-task progress from /tasks (server joins). retry:false → fast
  // graceful fallback on error. Status/polling authority is runDetail (isApplying).
  const tasksQ = useQuery({
    queryKey: ['run-tasks', name, applyId],
    queryFn: () => keeperApi.incarnations.runTasks(name, applyId),
    enabled: Boolean(name) && Boolean(applyId),
    retry: false,
    refetchInterval: isApplying ? 3000 : false,
  });
  // Primary is ready only if the response has that shape (tasks[] present). Fallback if
  // /tasks is unavailable: network error / 404 / 501 OR the body doesn't match the contract —
  // we degrade to per-host + audit instead of crashing.
  const tasksReady = Array.isArray(tasksQ.data?.tasks);
  const tasksUnavailable = tasksQ.isError || (tasksQ.data != null && !tasksReady);

  // Fallback path: audit = task history (task.executed by correlation_id=applyId).
  // Loaded ONLY when /tasks is unavailable — otherwise an extra request. 403 → soft
  // degradation (banner), the per-host summary remains.
  const auditQ = useQuery({
    queryKey: ['run-audit-tasks', name, applyId],
    queryFn: () =>
      keeperApi.audit.list({ correlation_id: applyId, type: ['task.executed'], limit: 500 }),
    enabled: Boolean(name) && Boolean(applyId) && tasksUnavailable,
    retry: false,
    refetchInterval: isApplying ? 3000 : false,
  });
  const auditForbidden = auditQ.error instanceof ApiError && auditQ.error.status === 403;

  const terminalHandledRef = useRef(false);
  const sawApplyingRef = useRef(false);

  // The route isn't recreated on :applyId change (no key) — reset one-shot guards,
  // otherwise the terminal state of one run would "stick" to the next.
  useEffect(() => {
    terminalHandledRef.current = false;
    sawApplyingRef.current = false;
  }, [applyId]);

  // SSE live-nudge: subscribed only while the run is applying. On each task.executed
  // the server has already recorded the outcome (audit/join) — we invalidate both paths
  // (primary /tasks + fallback audit) → instant refetch, live feel. We do NOT render the
  // frame directly (data authority is the server). AbortController closes the stream on
  // unmount and on transition to terminal (effect restarts on status change). Errors are
  // swallowed — status authority is runDetail's polling.
  useEffect(() => {
    if (!name || !applyId || status !== 'applying') return;
    const ctrl = new AbortController();
    void subscribeRunEvents(name, applyId, {
      signal: ctrl.signal,
      onEvent: (frame) => {
        if (frame.event !== 'task.executed') return;
        qc.invalidateQueries({ queryKey: ['run-tasks', name, applyId] });
        qc.invalidateQueries({ queryKey: ['run-audit-tasks', name, applyId] });
      },
      onError: () => {
        /* graceful: polling remains the source of authoritative status */
      },
    });
    return () => ctrl.abort();
  }, [name, applyId, status, qc]);

  // Run terminal state (authority = polled runDetail.status): refetch task progress +
  // per-host slice + the parent incarnation (status/applying_apply_id) ONE final time.
  // Only on the applying→terminal TRANSITION (sawApplyingRef), so we don't refetch
  // when opening an already-finished run.
  useEffect(() => {
    if (status === 'applying') {
      sawApplyingRef.current = true;
      return;
    }
    if (!name || !applyId || !status) return;
    if (!sawApplyingRef.current || terminalHandledRef.current) return;
    terminalHandledRef.current = true;
    qc.invalidateQueries({ queryKey: ['run-tasks', name, applyId] });
    qc.invalidateQueries({ queryKey: ['run-audit-tasks', name, applyId] });
    qc.invalidateQueries({ queryKey: ['incarnation-run', name, applyId] });
    qc.invalidateQueries({ queryKey: ['incarnation', name] });
  }, [name, applyId, status, qc]);

  const auditRows = useMemo(() => {
    const out: TaskRow[] = [];
    for (const ev of auditQ.data?.items ?? []) {
      if (ev.type !== 'task.executed') continue;
      const row = normalizeAuditTaskPayload(ev.payload);
      if (row) out.push(row);
    }
    return sortTaskRows(out);
  }, [auditQ.data]);

  if (q.isLoading && !q.data) return <div className={styles.loading}>{t('loading')}</div>;
  if (q.error) {
    return (
      <div className={styles.errorBox}>
        {q.error instanceof ApiError
          ? t('errors:generic', { status: q.error.status, detail: q.error.message })
          : String(q.error)}
      </div>
    );
  }
  const run = q.data;
  if (!run) return <div className={styles.empty}>{t('runhistory:runNotFound')}</div>;

  const hosts = run.hosts ?? [];
  const failedHosts = hosts.filter((h) => h.error_summary || h.failed_task_idx != null || h.failed_plan_index != null);

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.crumbs}>
          <Link to="/incarnations">incarnations</Link> /{' '}
          <Link to={`/incarnations/${encodeURIComponent(name)}`}>{name}</Link> /{' '}
          <span className="mono">{applyId}</span>
        </div>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>
              <Activity size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
              <span className="mono" style={{ fontSize: 18 }}>{applyId}</span>
            </h1>
          </div>
          <div data-testid="run-status">
            <Badge tone={runStatusTone(run.status)}>{run.status}</Badge>
          </div>
        </div>
      </div>

      <section className={styles.section} aria-label="Run meta">
        <div className={styles.meta}>
          <span className={styles.metaKey}>{t('runhistory:runScenarioLabel')}</span>
          <span className={styles.metaVal}>{run.scenario}</span>
          {run.started_by_aid ? (
            <>
              <span className={styles.metaKey}>{t('runhistory:runStartedByLabel')}</span>
              <span className={styles.metaVal}>
                <Link to={`/archons/${encodeURIComponent(run.started_by_aid)}`}>{run.started_by_aid}</Link>
              </span>
            </>
          ) : null}
          <span className={styles.metaKey}>started_at</span>
          <span className={styles.metaVal}>{run.started_at}</span>
          {run.finished_at ? (
            <>
              <span className={styles.metaKey}>finished_at</span>
              <span className={styles.metaVal}>{run.finished_at}</span>
            </>
          ) : null}
        </div>
      </section>

      {run.input && Object.keys(run.input).length > 0 ? (
        <section className={styles.section} aria-label="Run input" data-testid="run-input-section">
          <h2 className={styles.sectionTitle}>{t('runhistory:runInputTitle')}</h2>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-muted)' }}>
            {t('runhistory:runInputMaskedHint')}
          </p>
          <JsonViewer value={run.input} />
        </section>
      ) : null}

      {failedHosts.length > 0 ? (
        <section className={styles.section} aria-label="Failed task" data-testid="run-failed-section">
          <h2 className={styles.sectionTitle}>{t('runhistory:runFailedTaskTitle')}</h2>
          {failedHosts.map((h) => (
            <div key={`${h.sid}-${h.passage}`} className={styles.errorBox} style={{ marginBottom: 8 }}>
              <div className="mono" style={{ fontWeight: 600, marginBottom: 4 }}>
                <KeeperSidCell sid={h.sid} />
              </div>
              {h.failed_task_idx != null ? (
                <div>{t('runhistory:runFailedTaskIdx', { idx: h.failed_task_idx })}</div>
              ) : null}
              {h.failed_plan_index != null ? (
                <div>{t('runhistory:runFailedPlanIndex', { idx: h.failed_plan_index })}</div>
              ) : null}
              {h.error_summary ? <div className="mono">{h.error_summary}</div> : null}
            </div>
          ))}
        </section>
      ) : null}

      <section className={styles.section} aria-label="Per-host">
        <h2 className={styles.sectionTitle}>{t('runhistory:runHostsTitle')}</h2>
        {hosts.length > 0 ? (
          <table className={styles.table} data-testid="run-hosts-table">
            <thead>
              <tr>
                <th>{t('common:colSid')}</th>
                <th>{t('colStatus')}</th>
                <th>{t('runhistory:runColPassage')}</th>
                <th>{t('runhistory:runColAttempt')}</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map((h) => (
                <tr key={`${h.sid}-${h.passage}`} data-testid={`run-host-row-${h.sid}`}>
                  <td className="mono">
                    <KeeperSidCell sid={h.sid} />
                  </td>
                  <td>
                    <Badge tone={runStatusTone(h.status)}>
                      {h.status}
                      {h.cancel_requested ? ` · ${t('runhistory:runCancelRequested')}` : ''}
                    </Badge>
                  </td>
                  <td className="mono">{h.passage}</td>
                  <td className="mono">{h.attempt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className={styles.empty}>{t('runhistory:runHostsEmpty')}</div>
        )}
      </section>

      {tasksReady ? (
        <RunTasks tasks={tasksQ.data!.tasks ?? []} live={isApplying} />
      ) : tasksUnavailable ? (
        <TaskTimeline rows={auditRows} degraded={auditForbidden} live={isApplying} />
      ) : (
        <section className={styles.section} aria-label="Task timeline" data-testid="run-task-timeline">
          <h2 className={styles.sectionTitle}>{t('runhistory:runTasksTitle')}</h2>
          <div className={styles.loading}>{t('loading')}</div>
        </section>
      )}
    </div>
  );
}
