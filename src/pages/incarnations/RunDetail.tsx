import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge } from '../../components/primitives';
import { runStatusTone } from '../../components/status';
import styles from '../common.module.css';

// Run-view: детали одного apply_run инкарнации (create/rerun-create/day-2
// scenario-прогон). НЕ Voyage (batch-прогон по многим инкарнациям) — apply_run
// адресует ровно одну инкарнацию, поэтому отдельный route/страница вместо
// переиспользования VoyageDetail.
//
// Detail = per-host срез статусов + адрес упавшей задачи (task_idx/plan_index/
// error_summary), НЕ полный per-task список: TaskEvent агрегируется на Soul-е
// без per-task-прогресса, PG хранит только упавшую задачу на host-строке (ADR-012).
const NON_TERMINAL = new Set(['applying']);

// Keeper-side задача (`on: keeper`, docs/keeper/modules.md) не исполняется на
// Soul — исполнителем выступает сам keeper-инстанс. Backend отдаёт для неё
// синтетический apply_runs-row с sid="keeper" (keeper/internal/render/render.go
// KeeperTargetSID) — это НЕ soul, ссылка на /souls/keeper вела бы на
// несуществующую/чужую сущность.
const KEEPER_TARGET_SID = 'keeper';

function HostSidCell({ sid }: { sid: string }) {
  const { t } = useTranslation();
  if (sid === KEEPER_TARGET_SID) {
    return (
      <>
        <span className="mono">{sid}</span>{' '}
        <Badge tone="info" title={t('runhistory:runKeeperSideHint')}>
          {t('runhistory:runKeeperSideBadge')}
        </Badge>
      </>
    );
  }
  return <Link to={`/souls/${encodeURIComponent(sid)}`}>{sid}</Link>;
}

export function RunDetail() {
  const { t } = useTranslation();
  const { name = '', applyId = '' } = useParams<{ name: string; applyId: string }>();

  const q = useQuery({
    queryKey: ['incarnation-run', name, applyId],
    queryFn: () => keeperApi.incarnations.runDetail(name, applyId),
    enabled: Boolean(name) && Boolean(applyId),
    refetchInterval: (query) => (NON_TERMINAL.has(query.state.data?.status ?? '') ? 3000 : false),
  });

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
          <div>
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

      {failedHosts.length > 0 ? (
        <section className={styles.section} aria-label="Failed task">
          <h2 className={styles.sectionTitle}>{t('runhistory:runFailedTaskTitle')}</h2>
          {failedHosts.map((h) => (
            <div key={`${h.sid}-${h.passage}`} className={styles.errorBox} style={{ marginBottom: 8 }}>
              <div className="mono" style={{ fontWeight: 600, marginBottom: 4 }}>
                <HostSidCell sid={h.sid} />
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
          <table className={styles.table}>
            <thead>
              <tr>
                <th>SID</th>
                <th>Status</th>
                <th>{t('runhistory:runColPassage')}</th>
                <th>{t('runhistory:runColAttempt')}</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map((h) => (
                <tr key={`${h.sid}-${h.passage}`}>
                  <td className="mono">
                    <HostSidCell sid={h.sid} />
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
    </div>
  );
}
