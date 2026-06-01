import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Anchor, Ban } from 'lucide-react';
import { useState } from 'react';
import {
  keeperApi,
  type Voyage,
  type VoyageStatus,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button } from '../../components/primitives';
import { runStatusTone } from '../../components/status';
import styles from '../common.module.css';

// satisfies: перечисление ⊆ VoyageStatus; при добавлении статуса в backend tsc потребует пересмотра.
const NON_TERMINAL_STATUSES = ['pending', 'scheduled', 'running'] as const satisfies readonly VoyageStatus[];
const NON_TERMINAL: ReadonlySet<string> = new Set(NON_TERMINAL_STATUSES);

function progressPct(v: Voyage): number {
  if (!v.total_batches || v.total_batches <= 0) return 0;
  const done = Math.max(0, Math.min(v.current_batch_index, v.total_batches));
  return Math.round((done / v.total_batches) * 100);
}

export function VoyageDetail() {
  const { t } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);

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
                  <span className={styles.metaVal}>{voyage.target.sids.join(', ')}</span>
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
          <span className={styles.metaVal}>{voyage.started_by_aid}</span>

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
          {t('runhistory:voyageProgressTitle', {
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
            <Badge tone="ok">{t('runhistory:countSucceeded', { n: summary.succeeded })}</Badge>
            <Badge tone={summary.failed > 0 ? 'danger' : 'muted'}>
              {t('runhistory:countFailed', { n: summary.failed })}
            </Badge>
            <Badge tone={summary.cancelled > 0 ? 'warn' : 'muted'}>
              {t('runhistory:countCancelled', { n: summary.cancelled })}
            </Badge>
            {summary.no_match !== undefined ? (
              <Badge tone="muted">
                {t('runhistory:countNoMatch', { n: summary.no_match })}
              </Badge>
            ) : null}
            <Badge tone="muted">{t('runhistory:countTotal', { n: summary.total })}</Badge>
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
