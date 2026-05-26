import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Dot } from '../../components/primitives';
import { JsonViewer } from '../../components/JsonViewer';
import { keeperApi, type DriftReport } from '../../api/keeper';
import { incarnationDot, incarnationTone } from '../../components/status';
import { ApiError } from '../../api/client';
import styles from '../common.module.css';

type Tab = 'state' | 'spec' | 'history' | 'drift';

export function IncarnationDetail() {
  const { name = '' } = useParams<{ name: string }>();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('state');
  const [drift, setDrift] = useState<DriftReport | null>(null);
  const [driftError, setDriftError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['incarnation', name],
    queryFn: () => keeperApi.incarnations.get(name),
    enabled: Boolean(name),
  });

  const history = useQuery({
    queryKey: ['incarnation-history', name],
    queryFn: () => keeperApi.incarnations.history(name, { limit: 50 }),
    enabled: Boolean(name) && tab === 'history',
  });

  const driftMu = useMutation({
    mutationFn: () => keeperApi.incarnations.checkDrift(name),
    onSuccess: (data) => {
      setDrift(data);
      setDriftError(null);
      // last_drift_summary в detail может измениться — инвалидируем.
      qc.invalidateQueries({ queryKey: ['incarnation', name] });
    },
    onError: (err) => {
      setDriftError(err instanceof ApiError ? `Ошибка ${err.status}: ${err.message}` : String(err));
    },
  });

  if (detail.isLoading) return <div className={styles.loading}>Загружаем…</div>;
  if (detail.error) {
    return (
      <div className={styles.errorBox}>
        {detail.error instanceof ApiError ? `Ошибка ${detail.error.status}: ${detail.error.message}` : String(detail.error)}
      </div>
    );
  }
  const row = detail.data;
  if (!row) return <div className={styles.empty}>Incarnation не найдена.</div>;

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.crumbs}>
          <Link to="/incarnations">incarnations</Link> / <span>{row.name}</span>
        </div>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>{row.name}</h1>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
              <Dot kind={incarnationDot(row.status)} />
              <Badge tone={incarnationTone(row.status)}>{row.status}</Badge>
              <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {row.service}@{row.service_version} · schema v{row.state_schema_version}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.meta}>
        <span className={styles.metaKey}>Covens</span>
        <span className={styles.metaVal}>{row.covens.length > 0 ? row.covens.join(', ') : '—'}</span>
        <span className={styles.metaKey}>Created by</span>
        <span className={styles.metaVal}>{row.created_by_aid}</span>
        <span className={styles.metaKey}>Created at</span>
        <span className={styles.metaVal}>{row.created_at}</span>
        <span className={styles.metaKey}>Updated at</span>
        <span className={styles.metaVal}>{row.updated_at}</span>
        <span className={styles.metaKey}>Last drift check</span>
        <span className={styles.metaVal}>{row.last_drift_check_at ?? '—'}</span>
      </div>

      <div className={styles.tabs} role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'state'} className={`${styles.tab} ${tab === 'state' ? styles.tabActive : ''}`} onClick={() => setTab('state')}>
          State
        </button>
        <button type="button" role="tab" aria-selected={tab === 'spec'} className={`${styles.tab} ${tab === 'spec' ? styles.tabActive : ''}`} onClick={() => setTab('spec')}>
          Spec
        </button>
        <button type="button" role="tab" aria-selected={tab === 'history'} className={`${styles.tab} ${tab === 'history' ? styles.tabActive : ''}`} onClick={() => setTab('history')}>
          History
        </button>
        <button type="button" role="tab" aria-selected={tab === 'drift'} className={`${styles.tab} ${tab === 'drift' ? styles.tabActive : ''}`} onClick={() => setTab('drift')}>
          Drift
        </button>
      </div>

      {tab === 'state' ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>incarnation.state</h2>
          <JsonViewer value={row.state ?? null} emptyLabel="state пустой" />
        </section>
      ) : null}

      {tab === 'spec' ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>incarnation.spec</h2>
          <JsonViewer value={row.spec ?? null} emptyLabel="spec не задан" />
        </section>
      ) : null}

      {tab === 'history' ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>state_history</h2>
          {history.isLoading ? <div className={styles.loading}>Загружаем…</div> : null}
          {history.error ? (
            <div className={styles.errorBox}>
              {history.error instanceof ApiError ? `Ошибка ${history.error.status}: ${history.error.message}` : String(history.error)}
            </div>
          ) : null}
          {history.data && history.data.items.length === 0 ? (
            <div className={styles.empty}>История пуста.</div>
          ) : null}
          <div className={styles.timeline}>
            {history.data?.items.map((entry) => (
              <div key={entry.apply_id} className={styles.timelineItem}>
                <div className={styles.timelineHead}>
                  <span>{entry.scenario}</span>
                  <span>{entry.started_at}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                  <Badge tone={incarnationTone(entry.status_before)}>{entry.status_before}</Badge>
                  <span style={{ color: 'var(--text-faint)' }}>→</span>
                  <Badge tone={incarnationTone(entry.status_after)}>{entry.status_after}</Badge>
                  <span className="mono" style={{ color: 'var(--text-faint)', marginLeft: 'auto' }}>
                    by {entry.changed_by_aid}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {tab === 'drift' ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Check drift</h2>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Button variant="primary" onClick={() => driftMu.mutate()} disabled={driftMu.isPending}>
              {driftMu.isPending ? 'Сканируем…' : 'Запустить drift-scan'}
            </Button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              POST /v1/incarnations/{row.name}/check-drift
            </span>
          </div>
          {driftError ? <div className={styles.errorBox}>{driftError}</div> : null}
          {drift ? (
            <>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Badge tone="warn">drifted: {drift.counts.hosts_drifted}</Badge>
                <Badge tone="ok">clean: {drift.counts.hosts_clean}</Badge>
                <Badge tone="muted">unsupported: {drift.counts.hosts_unsupported}</Badge>
                <Badge tone="danger">failed: {drift.counts.hosts_failed}</Badge>
              </div>
              <JsonViewer value={drift} />
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
