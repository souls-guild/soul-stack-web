import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import {
  keeperApi,
  type PushApplyView,
  type PushRunStatus,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge } from '../../components/primitives';
import { KeeperSidCell } from '../../components/KeeperSidCell';
import { JsonViewer } from '../../components/JsonViewer';
import { pushStatusTone } from './status';
import styles from '../common.module.css';

// satisfies: enum ⊆ PushRunStatus; adding a status on backend will make tsc demand a review.
const NON_TERMINAL_STATUSES = ['pending', 'running'] as const satisfies readonly PushRunStatus[];
const NON_TERMINAL: ReadonlySet<string> = new Set(NON_TERMINAL_STATUSES);

interface HostSummary {
  sid: string;
  status: string;
  error_code?: string;
  error?: string;
}

// summary is additionalProperties: true. Extract hosts[] guarded.
function readHosts(summary: PushApplyView['summary'] | undefined): HostSummary[] | null {
  if (!summary || typeof summary !== 'object') return null;
  const hosts = (summary as { hosts?: unknown }).hosts;
  if (!Array.isArray(hosts)) return null;
  return hosts.filter(
    (h): h is HostSummary =>
      !!h && typeof h === 'object' && typeof (h as HostSummary).sid === 'string',
  );
}

export function PushRunDetail() {
  const { t } = useTranslation();
  const { applyId = '' } = useParams<{ applyId: string }>();

  const q = useQuery({
    queryKey: ['push.get', applyId],
    queryFn: () => keeperApi.push.get(applyId),
    enabled: Boolean(applyId),
    refetchInterval: (query) => {
      const data = query.state.data as PushApplyView | undefined;
      if (!data) return 3000;
      return NON_TERMINAL.has(data.status ?? '') ? 3000 : false;
    },
  });

  if (q.isLoading && !q.data) return <div className={styles.loading}>{t('loading')}</div>;
  if (q.error) {
    return (
      <div className={styles.errorBox}>
        {q.error instanceof ApiError ? t('errors:generic', { status: q.error.status, detail: q.error.message }) : String(q.error)}
      </div>
    );
  }
  const view = q.data;
  if (!view) return <div className={styles.empty}>{t('runhistory:pushRunNotFound')}</div>;

  const hosts = readHosts(view.summary);
  const targets = view.inventory_sids?.length ?? 0;

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.crumbs}>
          <Link to="/push-runs">push runs</Link> / <span className="mono">{applyId}</span>
        </div>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>
              <Send size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
              <span className="mono" style={{ fontSize: 18 }}>{applyId}</span>
            </h1>
          </div>
          <div>
            <Badge tone={pushStatusTone(view.status)}>{view.status}</Badge>
          </div>
        </div>
      </div>

      <section className={styles.section} aria-label={t('runhistory:pushMetaAria')}>
        <div className={styles.meta}>
          <span className={styles.metaKey}>destiny</span>
          <span className={styles.metaVal}>{view.destiny_ref}</span>
          <span className={styles.metaKey}>ssh_provider</span>
          <span className={styles.metaVal}>{view.ssh_provider || 'routing'}</span>
          <span className={styles.metaKey}>targets</span>
          <span className={styles.metaVal}>{targets}</span>
          <span className={styles.metaKey}>cleanup_stale</span>
          <span className={styles.metaVal}>{view.cleanup_stale ? 'yes' : 'no'}</span>
          {view.started_by_aid ? (
            <>
              <span className={styles.metaKey}>started_by</span>
              <span className={styles.metaVal}>{view.started_by_aid}</span>
            </>
          ) : null}
          <span className={styles.metaKey}>started_at</span>
          <span className={styles.metaVal}>{view.started_at}</span>
          {view.finished_at ? (
            <>
              <span className={styles.metaKey}>finished_at</span>
              <span className={styles.metaVal}>{view.finished_at}</span>
            </>
          ) : null}
        </div>
      </section>

      <section className={styles.section} aria-label={t('common:secPerHost')}>
        <h2 className={styles.sectionTitle}>{t('secPerHost')}</h2>
        {hosts && hosts.length > 0 ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('common:colSid')}</th>
                <th>{t('colStatus')}</th>
                <th>{t('colError')}</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map((h) => (
                <tr key={h.sid}>
                  <td className="mono">
                    <KeeperSidCell sid={h.sid} />
                  </td>
                  <td>
                    <Badge tone={pushStatusTone(h.status)}>{h.status}</Badge>
                  </td>
                  <td className="mono">{h.error_code || h.error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : NON_TERMINAL.has(view.status ?? '') ? (
          <div className={styles.empty}>{t('runhistory:pushHostsAfterTerminal')}</div>
        ) : (
          <JsonViewer value={view.summary} emptyLabel={t('runhistory:summaryEmptyJson')} />
        )}
      </section>

      {view.input ? (
        <section className={styles.section} aria-label={t('common:secInput')}>
          <h2 className={styles.sectionTitle}>{t('secInput')}</h2>
          <JsonViewer value={view.input} emptyLabel={t('runhistory:summaryEmptyInput')} />
        </section>
      ) : null}
    </div>
  );
}
