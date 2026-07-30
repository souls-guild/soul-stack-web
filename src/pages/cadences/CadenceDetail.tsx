import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, CalendarClock } from 'lucide-react';
import { keeperApi, type Voyage, type VoyageStatus } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge } from '../../components/primitives';
import { runStatusTone } from '../../components/status';
import { relative, scheduleLabel } from './format';
import styles from '../common.module.css';

const NON_TERMINAL_VOYAGE: ReadonlySet<VoyageStatus> = new Set<VoyageStatus>(['pending', 'scheduled', 'running']);

export function CadenceDetail() {
  const { t } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();

  const cadenceQ = useQuery({
    queryKey: ['cadence.get', id],
    queryFn: () => keeperApi.cadences.get(id),
    enabled: Boolean(id),
  });

  const runsQ = useQuery({
    queryKey: ['cadence.runs', id],
    queryFn: () => keeperApi.cadences.runs(id, { limit: 50 }),
    enabled: Boolean(id),
    // Refetch while there are running child Voyages.
    refetchInterval: (query) => {
      const items = (query.state.data as { items?: Voyage[] } | undefined)?.items ?? [];
      const hasRunning = items.some((v) => NON_TERMINAL_VOYAGE.has(v.status as VoyageStatus));
      return hasRunning ? 5000 : false;
    },
  });

  if (cadenceQ.isLoading) return <div className={styles.loading}>{t('loading')}</div>;
  if (cadenceQ.error) {
    return (
      <div className={styles.errorBox}>
        {cadenceQ.error instanceof ApiError
          ? t('errors:generic', { status: cadenceQ.error.status, detail: cadenceQ.error.message })
          : String(cadenceQ.error)}
      </div>
    );
  }

  const c = cadenceQ.data;
  if (!c) return null;

  const runs = runsQ.data?.items ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <CalendarClock size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
            {c.name}
          </h1>
          <div className={styles.crumbs}>
            <Link to="/cadences">{t('cadences:title')}</Link>
            {' / '}
            {c.cadence_id}
          </div>
        </div>
        <div>
          {c.enabled ? (
            <Badge tone="ok">{t('cadences:enabled')}</Badge>
          ) : (
            <Badge tone="muted">{t('cadences:disabled')}</Badge>
          )}
        </div>
      </div>

      <div className={styles.section}>
        <dl className={styles.meta}>
          <dt className={styles.metaKey}>{t('cadences:colSchedule')}</dt>
          <dd className={styles.metaVal}>{scheduleLabel(c)}</dd>

          <dt className={styles.metaKey}>{t('cadences:colKind')}</dt>
          <dd className={styles.metaVal}>
            {c.kind}
            {c.scenario_name ? ` / ${c.scenario_name}` : ''}
            {c.module ? ` / ${c.module}` : ''}
          </dd>

          <dt className={styles.metaKey}>{t('cadences:colOverlap')}</dt>
          <dd className={styles.metaVal}>{t(`cadences:overlap_${c.overlap_policy}`)} ({c.overlap_policy})</dd>

          <dt className={styles.metaKey}>{t('cadences:colNextRun')}</dt>
          <dd className={styles.metaVal}>{c.next_run_at ? `${relative(c.next_run_at)} (${c.next_run_at})` : '—'}</dd>

          <dt className={styles.metaKey}>{t('cadences:colLastRun')}</dt>
          <dd className={styles.metaVal}>{c.last_run_at ? `${relative(c.last_run_at)} (${c.last_run_at})` : '—'}</dd>

          <dt className={styles.metaKey}>{t('colCreatedBy')}</dt>
          <dd className={styles.metaVal}>
            <Link
              to={`/archons/${encodeURIComponent(c.created_by_aid)}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              {c.created_by_aid}
            </Link>
          </dd>

          <dt className={styles.metaKey}>{t('cadences:createdAt')}</dt>
          <dd className={styles.metaVal}>{relative(c.created_at)}</dd>
        </dl>

        <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--surface-raised, var(--surface))', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)' }}>
          <Bell size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          {t('cadences:notificationsHint')}{' '}
          <Link
            to={`/notifications?tab=tidings&cadence=${encodeURIComponent(c.name)}`}
            data-testid="cadence-notifications-link"
            style={{ color: 'var(--accent)', textDecoration: 'none' }}
          >
            {t('cadences:notificationsLinkLabel')}
          </Link>
        </div>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('cadences:runsTitle')}</h2>
        {runsQ.isLoading ? (
          <div className={styles.loading}>{t('loading')}</div>
        ) : runsQ.error ? (
          <div className={styles.errorBox}>
            {runsQ.error instanceof ApiError
              ? t('errors:generic', { status: (runsQ.error as ApiError).status, detail: (runsQ.error as ApiError).message })
              : String(runsQ.error)}
          </div>
        ) : runs.length === 0 ? (
          <div className={styles.empty}>{t('cadences:runsEmpty')}</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('common:colId')}</th>
                <th>{t('cadences:runsColStatus')}</th>
                <th>{t('cadences:runsColScope')}</th>
                <th>{t('cadences:runsColStarted')}</th>
                <th>{t('cadences:runsColFinished')}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((v: Voyage) => (
                <tr key={v.voyage_id}>
                  <td>
                    <Link to={`/voyages/${encodeURIComponent(v.voyage_id)}`}>
                      {v.voyage_id}
                    </Link>
                  </td>
                  <td>
                    <Badge tone={runStatusTone(v.status)}>{v.status}</Badge>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>
                    {v.scope_size ?? '—'}
                  </td>
                  <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    {relative(v.started_at)}
                  </td>
                  <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    {relative(v.finished_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
