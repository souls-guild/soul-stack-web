import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Anchor, Ban } from 'lucide-react';
import { useState } from 'react';
import {
  keeperApi,
  type Voyage,
  type VoyageStatus,
  type AuditEvent,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button } from '../../components/primitives';
import { runStatusTone } from '../../components/status';
import styles from '../common.module.css';
import { VoyageTargets } from './VoyageTargets';

function relDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

interface VoyageNotificationsProps {
  events: AuditEvent[];
  isLoading: boolean;
  error: Error | null;
}

function VoyageNotifications({ events, isLoading, error }: VoyageNotificationsProps) {
  const { t } = useTranslation('notifications');

  if (isLoading) return <div className={styles.loading}>{t('common:loading')}</div>;
  if (error) return (
    <div className={styles.errorBox}>
      {error instanceof ApiError
        ? t('errors:generic', { status: error.status, detail: error.message })
        : String(error)}
    </div>
  );
  if (events.length === 0) return <div className={styles.empty}>{t('voyageNotificationsEmpty')}</div>;

  return (
    <table className={styles.table} data-testid="voyage-notifications-table">
      <thead>
        <tr>
          <th>{t('voyageNotifColHerald')}</th>
          <th>{t('voyageNotifColTiding')}</th>
          <th>{t('voyageNotifColEvent')}</th>
          <th>{t('voyageNotifColStatus')}</th>
          <th>{t('voyageNotifColCode')}</th>
          <th>{t('voyageNotifColAttempt')}</th>
          <th>{t('voyageNotifColTime')}</th>
        </tr>
      </thead>
      <tbody>
        {events.map((ev) => {
          const p = ev.payload as Record<string, unknown>;
          const heraldName = typeof p.herald === 'string' ? p.herald : null;
          const tidingName = typeof p.tiding === 'string' ? p.tiding : null;
          const statusCode = typeof p.status_code === 'number' ? p.status_code : null;
          const attempt = typeof p.attempt === 'number' ? p.attempt : null;
          const isDelivered = ev.type === 'herald.delivered';
          return (
            <tr key={ev.id} data-testid={`notif-row-${ev.id}`}>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                {heraldName ? (
                  <Link to={`/notifications/heralds/${encodeURIComponent(heraldName)}`}>
                    {heraldName}
                  </Link>
                ) : '—'}
              </td>
              <td style={{ fontSize: 12 }}>
                {tidingName ? (
                  <Link to={`/notifications/tidings/${encodeURIComponent(tidingName)}`}>
                    {tidingName}
                  </Link>
                ) : '—'}
              </td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{ev.type}</td>
              <td>
                <Badge tone={isDelivered ? 'ok' : 'danger'}>
                  {isDelivered ? t('heraldDeliveryStatusDelivered') : t('heraldDeliveryStatusFailed')}
                </Badge>
              </td>
              <td style={{ fontSize: 12 }}>{statusCode ?? '—'}</td>
              <td style={{ fontSize: 12 }}>{attempt ?? '—'}</td>
              <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{relDate(ev.created_at)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// satisfies: перечисление ⊆ VoyageStatus; при добавлении статуса в backend tsc потребует пересмотра.
const NON_TERMINAL_STATUSES = ['pending', 'scheduled', 'running'] as const satisfies readonly VoyageStatus[];
const NON_TERMINAL: ReadonlySet<string> = new Set(NON_TERMINAL_STATUSES);

function progressPct(v: Voyage): number {
  if (v.batch_mode === 'window') {
    if (!v.scope_size || v.scope_size <= 0) return 0;
    const done = windowDone(v);
    return Math.round((done / v.scope_size) * 100);
  }
  if (!v.total_batches || v.total_batches <= 0) return 0;
  const done = Math.max(0, Math.min(v.current_batch_index, v.total_batches));
  return Math.round((done / v.total_batches) * 100);
}

/** Число завершённых targets для window-режима: succeeded+failed+cancelled из summary */
function windowDone(v: Voyage): number {
  if (!v.summary) return 0;
  return (v.summary.succeeded ?? 0) + (v.summary.failed ?? 0) + (v.summary.cancelled ?? 0);
}

/** Tone бейджа summary-счётчика по статусу и числу. */
function summaryTone(s: 'succeeded' | 'failed' | 'cancelled', n: number): 'ok' | 'danger' | 'warn' | 'muted' {
  if (s === 'succeeded') return 'ok';
  if (s === 'failed') return n > 0 ? 'danger' : 'muted';
  return n > 0 ? 'warn' : 'muted';
}

export function VoyageDetail() {
  const { t } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['voyage.get', id],
    queryFn: () => keeperApi.voyages.get(id),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const data = query.state.data as Voyage | undefined;
      if (!data) return 3000;
      return NON_TERMINAL.has(data.status) ? 3000 : false;
    },
  });

  const cancelMu = useMutation({
    mutationFn: () => keeperApi.voyages.cancel(id),
    onSuccess: () => {
      setCancelOpen(false);
      qc.invalidateQueries({ queryKey: ['voyage.get', id] });
    },
  });

  const notifQ = useQuery({
    queryKey: ['voyage.notifications', id],
    queryFn: () =>
      keeperApi.audit.list({
        type: ['herald.delivered', 'herald.failed'],
        correlation_id: id,
        limit: 200,
      }),
    enabled: Boolean(id),
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
  const voyage = q.data;
  if (!voyage) return <div className={styles.empty}>{t('runhistory:voyageNotFound')}</div>;

  const isRunning = NON_TERMINAL.has(voyage.status);
  const pct = progressPct(voyage);
  const summary = voyage.summary;

  const kindLabel = voyage.kind === 'scenario'
    ? t('runhistory:voyageScenarioTypeLabel')
    : t('runhistory:voyageCommandTypeLabel');

  const targetDesc = voyage.kind === 'scenario'
    ? voyage.scenario_name ?? '—'
    : voyage.module ?? '—';

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.crumbs}>
          <Link to="/runs">{t('runhistory:runsFeedCrumbs').split('(')[0].trim()}</Link> /{' '}
          <span className="mono">{id}</span>
        </div>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>
              <Anchor size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
              <Badge tone="info">{kindLabel}</Badge>{' '}
              <span className="mono" style={{ fontSize: 16 }}>{id}</span>
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Badge tone={runStatusTone(voyage.status)}>{voyage.status}</Badge>
            {isRunning ? (
              <Button type="button" variant="ghost" onClick={() => setCancelOpen(true)}>
                <Ban size={14} /> {t('cancelShort')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <section className={styles.section} aria-label="Voyage meta">
        <div className={styles.meta}>
          <span className={styles.metaKey}>kind</span>
          <span className={styles.metaVal}>{voyage.kind}</span>

          {voyage.kind === 'scenario' ? (
            <>
              <span className={styles.metaKey}>scenario</span>
              <span className={styles.metaVal}>{targetDesc}</span>
              {voyage.target?.incarnations && voyage.target.incarnations.length > 0 ? (
                <>
                  <span className={styles.metaKey}>target.incarnations</span>
                  <span className={styles.metaVal}>
                    {voyage.target.incarnations.map((name) => (
                      <span key={name} style={{ marginRight: 8 }}>
                        <Link to={`/incarnations/${encodeURIComponent(name)}`}>{name}</Link>
                      </span>
                    ))}
                  </span>
                </>
              ) : null}
            </>
          ) : (
            <>
              <span className={styles.metaKey}>module</span>
              <span className={styles.metaVal}>{targetDesc}</span>
              {voyage.target?.sids && voyage.target.sids.length > 0 ? (
                <>
                  <span className={styles.metaKey}>target.sids</span>
                  <span className={styles.metaVal}>
                    {voyage.target.sids.map((sid, i) => (
                      <span key={sid}>
                        {i > 0 ? ', ' : ''}
                        <Link
                          to={`/souls/${encodeURIComponent(sid)}`}
                          style={{ textDecoration: 'none', color: 'inherit' }}
                        >
                          {sid}
                        </Link>
                      </span>
                    ))}
                  </span>
                </>
              ) : null}
            </>
          )}

          <span className={styles.metaKey}>scope_size</span>
          <span className={styles.metaVal}>{voyage.scope_size}</span>

          {voyage.batch_size ? (
            <>
              <span className={styles.metaKey}>batch_size</span>
              <span className={styles.metaVal}>{voyage.batch_size}</span>
            </>
          ) : null}

          <span className={styles.metaKey}>concurrency</span>
          <span className={styles.metaVal}>{voyage.concurrency ?? '—'}</span>

          {voyage.on_failure ? (
            <>
              <span className={styles.metaKey}>on_failure</span>
              <span className={styles.metaVal}>{voyage.on_failure}</span>
            </>
          ) : null}

          {voyage.dry_run ? (
            <>
              <span className={styles.metaKey}>dry_run</span>
              <span className={styles.metaVal}>true</span>
            </>
          ) : null}

          <span className={styles.metaKey}>started_by</span>
          <span className={styles.metaVal}>
            {voyage.started_by_aid ? (
              <Link
                to={`/archons/${encodeURIComponent(voyage.started_by_aid)}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                {voyage.started_by_aid}
              </Link>
            ) : '—'}
          </span>

          <span className={styles.metaKey}>created_at</span>
          <span className={styles.metaVal}>{voyage.created_at}</span>

          {voyage.started_at ? (
            <>
              <span className={styles.metaKey}>started_at</span>
              <span className={styles.metaVal}>{voyage.started_at}</span>
            </>
          ) : null}

          {voyage.finished_at ? (
            <>
              <span className={styles.metaKey}>finished_at</span>
              <span className={styles.metaVal}>{voyage.finished_at}</span>
            </>
          ) : null}

          <span className={styles.metaKey}>attempt</span>
          <span className={styles.metaVal}>{voyage.attempt}</span>
        </div>
      </section>

      <section className={styles.section} aria-label="Voyage progress">
        <h2 className={styles.sectionTitle}>
          {voyage.batch_mode === 'window'
            ? t('runhistory:voyageProgressTitleWindow', {
                done: windowDone(voyage),
                total: voyage.scope_size,
              })
            : t('runhistory:voyageProgressTitle', {
                current: voyage.current_batch_index,
                total: voyage.total_batches,
              })}
        </h2>
        <div aria-label="progress" style={progressOuter}>
          <div style={{ ...progressInner, width: `${pct}%` }} />
        </div>
        <div className={styles.metaKey}>{pct}%</div>
      </section>

      {summary ? (
        <section className={styles.section} aria-label="Voyage summary">
          <h2 className={styles.sectionTitle}>{t('runhistory:voyageSummaryTitle')}</h2>
          <div data-testid="voyage-summary-counts" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(['succeeded', 'failed', 'cancelled'] as const).map((s) => {
              const n = summary[s] ?? 0;
              const isActive = statusFilter === s;
              const tone = summaryTone(s, n);
              return (
                <span
                  key={s}
                  data-filter={s}
                  data-active={isActive ? 'true' : undefined}
                  onClick={() => setStatusFilter(isActive ? null : s)}
                  style={{ cursor: 'pointer', outline: isActive ? '2px solid var(--accent)' : undefined, borderRadius: 'var(--radius)' }}
                >
                  <Badge tone={isActive ? 'info' : tone}>
                    {t(`runhistory:count${s.charAt(0).toUpperCase()}${s.slice(1)}` as Parameters<typeof t>[0], { n })}
                  </Badge>
                </span>
              );
            })}
            {summary.no_match !== undefined ? (
              <Badge tone="muted">
                {t('runhistory:countNoMatch', { n: summary.no_match })}
              </Badge>
            ) : null}
            <span
              data-filter="total"
              onClick={() => setStatusFilter(null)}
              style={{ cursor: 'pointer' }}
            >
              <Badge tone="muted">{t('runhistory:countTotal', { n: summary.total })}</Badge>
            </span>
          </div>
        </section>
      ) : (
        <section className={styles.section} aria-label="Voyage summary">
          <div className={styles.empty}>
            {isRunning
              ? t('runhistory:voyageSummaryPending')
              : t('runhistory:voyageSummaryEmpty')}
          </div>
        </section>
      )}

      <section className={styles.section} aria-label="Voyage targets">
        <h2 className={styles.sectionTitle}>{t('runhistory:voyageTargetsTitle')}</h2>
        <VoyageTargets voyageId={id} refetchInterval={isRunning ? 3000 : false} statusFilter={statusFilter} />
      </section>

      <section className={styles.section} aria-label="Voyage notifications" data-testid="voyage-notifications-section">
        <h2 className={styles.sectionTitle}>{t('notifications:voyageNotificationsTitle')}</h2>
        <VoyageNotifications events={notifQ.data?.items ?? []} isLoading={notifQ.isLoading} error={notifQ.error} />
      </section>

      {cancelOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Cancel Voyage"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 20,
              maxWidth: 480,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ fontWeight: 500 }}>{t('pages:cancelVoyageTitle')}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {t('pages:cancelVoyageHint')} <span className="mono">{id}</span>
            </div>
            {cancelMu.error ? (
              <div className={styles.errorBox}>
                {cancelMu.error instanceof ApiError
                  ? t('errors:generic', { status: cancelMu.error.status, detail: cancelMu.error.message })
                  : String(cancelMu.error)}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button type="button" variant="ghost" onClick={() => setCancelOpen(false)}>
                {t('close')}
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => cancelMu.mutate()}
                disabled={cancelMu.isPending}
              >
                {cancelMu.isPending ? t('cancelling') : t('cancel2')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const progressOuter = {
  height: 8,
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  overflow: 'hidden',
} as const;

const progressInner = {
  height: '100%',
  background: 'var(--accent)',
  transition: 'width 0.3s ease',
} as const;
