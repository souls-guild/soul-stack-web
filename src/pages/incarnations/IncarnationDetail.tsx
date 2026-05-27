import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, History as HistoryIcon, Lock, Play, Search, Trash } from 'lucide-react';
import { Badge, Button, Dot } from '../../components/primitives';
import { JsonViewer } from '../../components/JsonViewer';
import { keeperApi, type DriftReport } from '../../api/keeper';
import { incarnationDot, incarnationTone } from '../../components/status';
import { ApiError } from '../../api/client';
import { RunScenarioForm } from './RunScenarioForm';
import { UnlockModal } from './UnlockModal';
import { UpgradeModal } from './UpgradeModal';
import { DestroyModal } from './DestroyModal';
import { HostsTab } from './HostsTab';
import styles from '../common.module.css';

type Tab = 'overview' | 'hosts' | 'run' | 'history' | 'drift' | 'state';

export function IncarnationDetail() {
  const { name = '' } = useParams<{ name: string }>();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [drift, setDrift] = useState<DriftReport | null>(null);
  const [driftError, setDriftError] = useState<string | null>(null);

  const [unlockOpen, setUnlockOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [destroyOpen, setDestroyOpen] = useState(false);

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

  const isLocked = row.status === 'error_locked' || row.status === 'migration_failed' || row.status === 'destroy_failed';
  const isDestroying = row.status === 'destroying';
  const isReady = row.status === 'ready' || row.status === 'drift';

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
                <Link to={`/services/${encodeURIComponent(row.service)}`} style={{ color: 'inherit' }}>
                  {row.service}
                </Link>
                @{row.service_version} · schema v{row.state_schema_version}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isReady ? (
              <>
                <Button variant="primary" onClick={() => setTab('run')} title="Run scenario">
                  <Play size={14} /> Run Scenario
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => { setTab('drift'); driftMu.mutate(); }}
                  disabled={driftMu.isPending}
                  title="Check drift"
                >
                  <Search size={14} /> {driftMu.isPending ? 'Сканируем…' : 'Check Drift'}
                </Button>
                <Button variant="secondary" onClick={() => setUpgradeOpen(true)} title="Upgrade">
                  <ArrowUp size={14} /> Upgrade
                </Button>
                <Button variant="danger" onClick={() => setDestroyOpen(true)} title="Destroy">
                  <Trash size={14} /> Destroy
                </Button>
              </>
            ) : null}
            {isLocked ? (
              <Button variant="primary" onClick={() => setUnlockOpen(true)} title="Снять lock">
                <Lock size={14} /> Unlock
              </Button>
            ) : null}
            {isDestroying ? (
              <Button variant="ghost" disabled title="incarnation в состоянии destroying">
                Destroy in progress…
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className={styles.meta}>
        <span className={styles.metaKey}>Status</span>
        <span className={styles.metaVal}>
          <Badge tone={incarnationTone(row.status)}>{row.status}</Badge>
        </span>
        <span className={styles.metaKey}>Covens</span>
        <span className={styles.metaVal}>{row.covens.length > 0 ? row.covens.join(', ') : '—'}</span>
        <span className={styles.metaKey}>Created by</span>
        <span className={styles.metaVal}>
          <Link to={`/archons/${encodeURIComponent(row.created_by_aid)}`}>{row.created_by_aid}</Link>
        </span>
        <span className={styles.metaKey}>Created at</span>
        <span className={styles.metaVal}>{row.created_at}</span>
        <span className={styles.metaKey}>Updated at</span>
        <span className={styles.metaVal}>{row.updated_at}</span>
        <span className={styles.metaKey}>Last drift check</span>
        <span className={styles.metaVal}>{row.last_drift_check_at ?? '—'}</span>
      </div>

      <div className={styles.tabs} role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'overview'} className={`${styles.tab} ${tab === 'overview' ? styles.tabActive : ''}`} onClick={() => setTab('overview')}>
          Overview
        </button>
        <button type="button" role="tab" aria-selected={tab === 'hosts'} className={`${styles.tab} ${tab === 'hosts' ? styles.tabActive : ''}`} onClick={() => setTab('hosts')}>
          Hosts
        </button>
        <button type="button" role="tab" aria-selected={tab === 'run'} className={`${styles.tab} ${tab === 'run' ? styles.tabActive : ''}`} onClick={() => setTab('run')}>
          Run scenario
        </button>
        <button type="button" role="tab" aria-selected={tab === 'history'} className={`${styles.tab} ${tab === 'history' ? styles.tabActive : ''}`} onClick={() => setTab('history')}>
          <HistoryIcon size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />History
        </button>
        <button type="button" role="tab" aria-selected={tab === 'drift'} className={`${styles.tab} ${tab === 'drift' ? styles.tabActive : ''}`} onClick={() => setTab('drift')}>
          Drift Check
        </button>
        <button type="button" role="tab" aria-selected={tab === 'state'} className={`${styles.tab} ${tab === 'state' ? styles.tabActive : ''}`} onClick={() => setTab('state')}>
          State
        </button>
      </div>

      {tab === 'overview' ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Spec</h2>
          <JsonViewer value={row.spec ?? null} emptyLabel="spec не задан" />
          <div style={{ marginTop: 4 }}>
            <button
              type="button"
              onClick={() => setTab('hosts')}
              style={{
                background: 'transparent',
                border: 0,
                padding: 0,
                color: 'var(--accent)',
                fontFamily: 'inherit',
                fontSize: 12.5,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Connected souls на этой incarnation →
            </button>
            <span style={{ color: 'var(--text-faint)', fontSize: 12, marginLeft: 8 }}>
              соответствие с реальностью можно проверить через probe-scenario
            </span>
          </div>
          {row.status_details ? (
            <>
              <h2 className={styles.sectionTitle} style={{ marginTop: 12 }}>Status details</h2>
              <JsonViewer value={row.status_details} />
            </>
          ) : null}
          {row.last_drift_summary ? (
            <>
              <h2 className={styles.sectionTitle} style={{ marginTop: 12 }}>Last drift summary</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Badge tone="warn">drifted: {row.last_drift_summary.hosts_drifted ?? 0}</Badge>
                <Badge tone="ok">clean: {row.last_drift_summary.hosts_clean ?? 0}</Badge>
                <Badge tone="muted">unsupported: {row.last_drift_summary.hosts_unsupported ?? 0}</Badge>
                <Badge tone="danger">failed: {row.last_drift_summary.hosts_failed ?? 0}</Badge>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {tab === 'hosts' ? (
        <HostsTab incarnationName={row.name} spec={row.spec ?? null} />
      ) : null}

      {tab === 'run' ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Run scenario</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            POST <code className="mono">/v1/incarnations/{row.name}/scenarios/{'{scenario}'}</code> — async,
            ответ <code className="mono">202</code> + <code className="mono">apply_id</code>.
          </p>
          <RunScenarioForm incarnationName={row.name} />
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
          {history.data && history.data.items.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Apply ID</th>
                  <th>Changed by</th>
                  <th>Created at</th>
                </tr>
              </thead>
              <tbody>
                {history.data.items.map((entry) => (
                  <tr key={entry.history_id}>
                    <td className="mono">{entry.scenario}</td>
                    <td className="mono">{entry.apply_id}</td>
                    <td className="mono">{entry.changed_by_aid}</td>
                    <td className="mono">{entry.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}

      {tab === 'drift' ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Check drift</h2>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Button variant="primary" onClick={() => driftMu.mutate()} disabled={driftMu.isPending}>
              <Search size={14} /> {driftMu.isPending ? 'Сканируем…' : 'Запустить drift-scan'}
            </Button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              POST /v1/incarnations/{row.name}/check-drift
            </span>
          </div>
          {driftError ? <div className={styles.errorBox}>{driftError}</div> : null}
          {row.last_drift_check_at ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Last server-recorded check: <span className="mono">{row.last_drift_check_at}</span>
            </div>
          ) : null}
          {drift ? (
            <>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Badge tone="warn">drifted: {drift.summary.hosts_drifted}</Badge>
                <Badge tone="ok">clean: {drift.summary.hosts_clean}</Badge>
                <Badge tone="muted">unsupported: {drift.summary.hosts_unsupported}</Badge>
                <Badge tone="danger">failed: {drift.summary.hosts_failed}</Badge>
              </div>
              <JsonViewer value={drift} />
            </>
          ) : null}
        </section>
      ) : null}

      {tab === 'state' ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>incarnation.state (read-only)</h2>
          <JsonViewer value={row.state ?? null} emptyLabel="state пустой" />
        </section>
      ) : null}

      <UnlockModal open={unlockOpen} incarnationName={row.name} onClose={() => setUnlockOpen(false)} />
      <UpgradeModal
        open={upgradeOpen}
        incarnationName={row.name}
        currentRef={row.service_version}
        onClose={() => setUpgradeOpen(false)}
      />
      <DestroyModal open={destroyOpen} incarnationName={row.name} onClose={() => setDestroyOpen(false)} />
    </div>
  );
}
