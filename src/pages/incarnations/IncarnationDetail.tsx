import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowUp,
  FileText,
  History as HistoryIcon,
  Layers,
  Lock,
  Play,
  RefreshCw,
  Search,
  Tag,
  Trash,
} from 'lucide-react';
import { Badge, Button, Dot } from '../../components/primitives';
import { JsonViewer } from '../../components/JsonViewer';
import { keeperApi, type DriftReport } from '../../api/keeper';
import { incarnationDot, incarnationTone } from '../../components/status';
import { ApiError } from '../../api/client';
import { UnlockModal } from './UnlockModal';
import { RerunCreateModal } from './RerunCreateModal';
import { UpgradeModal } from './UpgradeModal';
import { DestroyModal } from './DestroyModal';
import { HostsTab } from './HostsTab';
import { ChoirsTab } from './ChoirsTab';
import { SpecTab } from './SpecTab';
import { StateTab } from './StateTab';
import { SchemaTab } from './SchemaTab';
import { IncarnationTraitsModal } from './IncarnationTraitsModal';
import styles from '../common.module.css';

type Tab = 'overview' | 'hosts' | 'choirs' | 'history' | 'drift' | 'spec' | 'state' | 'schema';

export function IncarnationDetail() {
  const { t } = useTranslation();
  const { name = '' } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [drift, setDrift] = useState<DriftReport | null>(null);
  const [driftError, setDriftError] = useState<string | null>(null);

  const [unlockOpen, setUnlockOpen] = useState(false);
  const [rerunCreateOpen, setRerunCreateOpen] = useState(false);
  const [rerunAcceptedId, setRerunAcceptedId] = useState<string | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [destroyOpen, setDestroyOpen] = useState(false);
  const [traitsOpen, setTraitsOpen] = useState(false);

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
      setDriftError(err instanceof ApiError ? t('errors:generic', { status: err.status, detail: err.message }) : String(err));
    },
  });

  // Summary-агрегат для Overview: считаем поля spec/state, declared/runtime hosts.
  // Зовём useMemo безусловно (хук не должен сидеть под if), значения берём через `?.`.
  const summary = useMemo(() => {
    const row = detail.data;
    const spec = (row?.spec ?? null) as Record<string, unknown> | null;
    const state = (row?.state ?? null) as Record<string, unknown> | null;
    const specKeys = spec && typeof spec === 'object' ? Object.keys(spec).length : 0;
    const stateKeys = state && typeof state === 'object' ? Object.keys(state).length : 0;
    let declaredHosts = 0;
    if (spec && Array.isArray((spec as Record<string, unknown>).hosts)) {
      declaredHosts = ((spec as Record<string, unknown>).hosts as unknown[]).length;
    }
    let runtimeHosts = 0;
    if (state && typeof state === 'object') {
      const hosts = (state as Record<string, unknown>).hosts;
      if (hosts && typeof hosts === 'object' && !Array.isArray(hosts)) {
        runtimeHosts = Object.keys(hosts as Record<string, unknown>).length;
      }
    }
    return { specKeys, stateKeys, declaredHosts, runtimeHosts };
  }, [detail.data]);

  if (detail.isLoading) return <div className={styles.loading}>{t('loading')}</div>;
  if (detail.error) {
    return (
      <div className={styles.errorBox}>
        {detail.error instanceof ApiError ? t('errors:generic', { status: detail.error.status, detail: detail.error.message }) : String(detail.error)}
      </div>
    );
  }
  const row = detail.data;
  if (!row) return <div className={styles.empty}>{t('incarnations:incarnationNotFound')}</div>;

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
                <Button
                  variant="primary"
                  onClick={() => {
                    const params = new URLSearchParams({
                      workload: 'scenario',
                      service: row.service,
                      incarnation: row.name,
                    });
                    navigate(`/run?${params.toString()}`);
                  }}
                  title={t('pages:runScenarioViaWizard')}
                >
                  <Play size={14} /> {t('runScenario')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => { setTab('drift'); driftMu.mutate(); }}
                  disabled={driftMu.isPending}
                  title="Check drift"
                >
                  <Search size={14} /> {driftMu.isPending ? t('scanning') : t('checkDrift')}
                </Button>
                <Button variant="secondary" onClick={() => setUpgradeOpen(true)} title="Upgrade">
                  <ArrowUp size={14} /> Upgrade
                </Button>
                <Button variant="secondary" onClick={() => setTraitsOpen(true)} title={t('incarnations:editTraitsTitle')}>
                  <Tag size={14} /> {t('incarnations:editTraitsBtn')}
                </Button>
                <Button variant="danger" onClick={() => setDestroyOpen(true)} title="Destroy">
                  <Trash size={14} /> Destroy
                </Button>
              </>
            ) : null}
            {isLocked ? (
              <>
                <Button variant="primary" onClick={() => setUnlockOpen(true)} title={t('incarnations:unlockTitleShort')}>
                  <Lock size={14} /> Unlock
                </Button>
                {row.status === 'error_locked' ? (
                  <Button
                    variant="secondary"
                    onClick={() => { setRerunAcceptedId(null); setRerunCreateOpen(true); }}
                    title={t('incarnations:rerunCreateTooltip')}
                  >
                    <RefreshCw size={14} /> {t('incarnations:rerunCreateBtn')}
                  </Button>
                ) : null}
              </>
            ) : null}
            {isDestroying ? (
              <Button variant="ghost" disabled title={t('incarnations:destroyInProgressTitle')}>
                {t('incarnations:destroyInProgress')}
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
        <span className={styles.metaVal}>{(row.covens ?? []).length > 0 ? (row.covens ?? []).join(', ') : '—'}</span>
        <span className={styles.metaKey}>Created by</span>
        <span className={styles.metaVal}>
          {row.created_by_aid
            ? <Link to={`/archons/${encodeURIComponent(row.created_by_aid)}`}>{row.created_by_aid}</Link>
            : <span style={{ color: 'var(--text-muted)' }}>—</span>
          }
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
        <button type="button" role="tab" aria-selected={tab === 'spec'} className={`${styles.tab} ${tab === 'spec' ? styles.tabActive : ''}`} onClick={() => setTab('spec')}>
          <FileText size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />Spec
        </button>
        <button type="button" role="tab" aria-selected={tab === 'state'} className={`${styles.tab} ${tab === 'state' ? styles.tabActive : ''}`} onClick={() => setTab('state')}>
          <Activity size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />State
        </button>
        <button type="button" role="tab" aria-selected={tab === 'schema'} className={`${styles.tab} ${tab === 'schema' ? styles.tabActive : ''}`} onClick={() => setTab('schema')}>
          <Layers size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />Schema
        </button>
        <button type="button" role="tab" aria-selected={tab === 'hosts'} className={`${styles.tab} ${tab === 'hosts' ? styles.tabActive : ''}`} onClick={() => setTab('hosts')}>
          Hosts
        </button>
        <button type="button" role="tab" aria-selected={tab === 'choirs'} className={`${styles.tab} ${tab === 'choirs' ? styles.tabActive : ''}`} onClick={() => setTab('choirs')}>
          Choirs
        </button>
        <button type="button" role="tab" aria-selected={tab === 'history'} className={`${styles.tab} ${tab === 'history' ? styles.tabActive : ''}`} onClick={() => setTab('history')}>
          <HistoryIcon size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />History
        </button>
        <button type="button" role="tab" aria-selected={tab === 'drift'} className={`${styles.tab} ${tab === 'drift' ? styles.tabActive : ''}`} onClick={() => setTab('drift')}>
          Drift Check
        </button>
      </div>

      {tab === 'overview' ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Data summary</h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            {t('incarnations:dataSummaryDesc')} <strong>Spec</strong> {t('incarnations:dataSummarySpecTail')},{' '}
            <strong>State</strong> {t('incarnations:dataSummaryStateTail')},{' '}
            <strong>Schema</strong> {t('incarnations:dataSummarySchemaTail')}, <strong>Hosts</strong> {t('incarnations:dataSummaryHostsTail')}
          </p>
          <div className={styles.summaryGrid}>
            <button type="button" className={styles.summaryCard} onClick={() => setTab('spec')}>
              <span className={styles.summaryCardLabel}>
                <FileText size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                Spec
              </span>
              <span className={styles.summaryCardValue}>
                {summary.specKeys} {summary.specKeys === 1 ? t('incarnations:fieldOne') : t('incarnations:fieldMany')}
              </span>
              <span className={styles.summaryCardHint}>{t('incarnations:declaredByOperator')}</span>
            </button>
            <button type="button" className={styles.summaryCard} onClick={() => setTab('state')}>
              <span className={styles.summaryCardLabel}>
                <Activity size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                State
              </span>
              <span className={styles.summaryCardValue}>
                {summary.stateKeys} {summary.stateKeys === 1 ? t('incarnations:fieldOne') : t('incarnations:fieldMany')}
              </span>
              <span className={styles.summaryCardHint}>{t('incarnations:runtimeAfterApply')}</span>
            </button>
            <button type="button" className={styles.summaryCard} onClick={() => setTab('schema')}>
              <span className={styles.summaryCardLabel}>
                <Layers size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                Schema
              </span>
              <span className={styles.summaryCardValue}>v{row.state_schema_version}</span>
              <span className={styles.summaryCardHint}>state_schema_version</span>
            </button>
            <button type="button" className={styles.summaryCard} onClick={() => setTab('hosts')}>
              <span className={styles.summaryCardLabel}>Hosts</span>
              <span className={styles.summaryCardValue}>
                {summary.declaredHosts} declared · {summary.runtimeHosts} runtime
              </span>
              <span className={styles.summaryCardHint}>{t('incarnations:hostsCardHint')}</span>
            </button>
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

      {tab === 'spec' ? <SpecTab spec={row.spec ?? null} /> : null}

      {tab === 'state' ? (
        <StateTab
          state={row.state ?? null}
          stateSchemaVersion={row.state_schema_version}
          incarnationName={row.name}
        />
      ) : null}

      {tab === 'schema' ? (
        <SchemaTab
          serviceName={row.service}
          serviceVersion={row.service_version}
          stateSchemaVersion={row.state_schema_version}
        />
      ) : null}

      {tab === 'hosts' ? (
        <HostsTab
          incarnationName={row.name}
          spec={row.spec ?? null}
          state={row.state ?? null}
          status={row.status}
        />
      ) : null}

      {tab === 'choirs' ? (
        <ChoirsTab incarnationName={row.name} />
      ) : null}

      {tab === 'history' ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>state_history</h2>
          {history.isLoading ? <div className={styles.loading}>{t('loading')}</div> : null}
          {history.error ? (
            <div className={styles.errorBox}>
              {history.error instanceof ApiError ? t('errors:generic', { status: history.error.status, detail: history.error.message }) : String(history.error)}
            </div>
          ) : null}
          {history.data && (history.data.items ?? []).length === 0 ? (
            <div className={styles.empty}>{t('incarnations:historyEmpty')}</div>
          ) : null}
          {history.data && (history.data.items ?? []).length > 0 ? (
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
                {(history.data.items ?? []).map((entry) => (
                  <tr key={entry.history_id}>
                    <td className="mono">{entry.scenario}</td>
                    <td className="mono">{entry.apply_id}</td>
                    <td className="mono">{entry.changed_by_aid ?? '—'}</td>
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
              <Search size={14} /> {driftMu.isPending ? t('scanning') : t('driftScan')}
            </Button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              POST /v1/incarnations/{row.name}/check-drift
            </span>
          </div>
          {driftError ? <div className={styles.errorBox}>{driftError}</div> : null}
          {row.last_drift_check_at ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t('incarnations:lastServerCheck')} <span className="mono">{row.last_drift_check_at}</span>
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

      {rerunAcceptedId ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
            background: 'var(--success, #2d7a4f)', color: '#fff',
            padding: '10px 18px', borderRadius: 'var(--radius)', fontSize: 13,
            boxShadow: '0 2px 12px rgba(0,0,0,.25)',
          }}
        >
          {t('incarnations:rerunCreateAccepted')} <span className="mono">{rerunAcceptedId}</span>
          <button
            type="button"
            onClick={() => setRerunAcceptedId(null)}
            aria-label={t('cancel')}
            style={{ marginLeft: 12, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14 }}
          >
            ×
          </button>
        </div>
      ) : null}
      <IncarnationTraitsModal open={traitsOpen} incarnationName={row.name} onClose={() => setTraitsOpen(false)} />
      <UnlockModal open={unlockOpen} incarnationName={row.name} onClose={() => setUnlockOpen(false)} />
      <RerunCreateModal
        open={rerunCreateOpen}
        incarnationName={row.name}
        onClose={() => setRerunCreateOpen(false)}
        onAccepted={(id) => setRerunAcceptedId(id)}
      />
      <UpgradeModal
        open={upgradeOpen}
        incarnationName={row.name}
        serviceName={row.service}
        currentRef={row.service_version}
        onClose={() => setUpgradeOpen(false)}
      />
      <DestroyModal open={destroyOpen} incarnationName={row.name} onClose={() => setDestroyOpen(false)} />
    </div>
  );
}
