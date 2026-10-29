import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowUp,
  CalendarClock,
  History as HistoryIcon,
  Layers,
  Lock,
  Play,
  RefreshCw,
  Tag,
  Trash,
  ExternalLink,
} from 'lucide-react';
import { Badge, Button, Dot } from '../../components/primitives';
import { JsonViewer } from '../../components/JsonViewer';
import { keeperApi, type IncarnationRerunLastReply } from '../../api/keeper';
import { incarnationDot, incarnationTone, runStatusTone } from '../../components/status';
import { entityCaption, showsIdBeside } from '../../components/entityCaption';
import { EditLabelModal } from '../../components/EditLabelModal';
import { ApiError } from '../../api/client';
import { UnlockModal } from './UnlockModal';
import { RerunLastModal } from './RerunLastModal';
import { UpgradeModal } from './UpgradeModal';
import { DestroyModal } from './DestroyModal';
import { HostsTab } from './HostsTab';
import { ChoirsTab } from './ChoirsTab';
import { StateTab } from './StateTab';
import { SchemaTab } from './SchemaTab';
import { MaintenanceTab } from './MaintenanceTab';
import { DeferredUntil } from '../voyages/DeferredUntil';
import { IncarnationTraitsModal } from './IncarnationTraitsModal';
import { TraitsChips } from './TraitsChips';
import styles from '../common.module.css';

type Tab = 'overview' | 'hosts' | 'choirs' | 'history' | 'state' | 'schema' | 'maintenance';

export function IncarnationDetail() {
  const { t } = useTranslation();
  const { name = '' } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');

  const [unlockOpen, setUnlockOpen] = useState(false);
  const [rerunLastOpen, setRerunLastOpen] = useState(false);
  const [rerunAccepted, setRerunAccepted] = useState<IncarnationRerunLastReply | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [destroyOpen, setDestroyOpen] = useState(false);
  const [traitsOpen, setTraitsOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);

  const detail = useQuery({
    queryKey: ['incarnation', name],
    queryFn: () => keeperApi.incarnations.get(name),
    enabled: Boolean(name),
  });

  // The History tab lists RUNS, one row each — not state versions. The
  // state-history endpoint answers with one entry per state WRITE, so a single
  // create of the redis service produced sixteen of them and the tab read as
  // sixteen runs (NIM-897). `/runs` is the server's own fold by apply_id, which is
  // the unit an operator thinks in, and it carries the run's status, which the
  // state-version rows never did.
  const history = useQuery({
    queryKey: ['incarnation-runs', name],
    queryFn: () => keeperApi.incarnations.runs(name, { limit: 50 }),
    enabled: Boolean(name) && tab === 'history',
  });

  // Runs deferred to a maintenance window are scheduled Voyages, not apply runs, so
  // `/runs` cannot show them.
  const deferred = useQuery({
    queryKey: ['incarnation-deferred-runs', name],
    queryFn: () => keeperApi.voyages.list({ incarnation: name, kind: 'scenario', status: ['scheduled'], limit: 200 }),
    enabled: Boolean(name) && tab === 'history',
    retry: false,
  });
  const deferredRows = (deferred.data?.items ?? []).filter((v) => v.schedule_at);

  // The roster for the Overview "Hosts" card — the membership relation, the same
  // list the Hosts tab shows. NOT the set a scenario run acts on: that one is
  // resolved server-side with no caller scope and then cut down to the hosts
  // holding a live presence lease, so it is neither a subset nor a superset of
  // this one (see [useIncarnationRosterSizes]).
  // Always loaded (not only on tab=hosts) so Overview shows the real count.
  //
  // This read `GET /v1/souls?coven=<name>` while ADR-080 had a host inherit the
  // name of every incarnation it belonged to; NIM-281 reverted that, so the label
  // and the roster are now different sets and the card counted the wrong one.
  // Same query key as the Hosts tab, so the card and the tab cannot disagree.
  const roster = useQuery({
    queryKey: ['incarnation-members', name],
    queryFn: () => keeperApi.incarnations.members(name),
    enabled: Boolean(name),
    // A 403 here is an ordinary answer for a narrow scope, not a blip. Retrying
    // it three times would leave the card sitting on its loading state for
    // seconds before it could say so — the other readers of this key already
    // fail fast for the same reason.
    retry: false,
  });

  // Summary aggregate for Overview: count state fields and roster members.
  // Call useMemo unconditionally (a hook must not sit under an if), values accessed via `?.`.
  const summary = useMemo(() => {
    const row = detail.data;
    const state = (row?.state ?? null) as Record<string, unknown> | null;
    const stateKeys = state && typeof state === 'object' ? Object.keys(state).length : 0;
    // `total` rather than `items.length` because it is the field that names the
    // count — the endpoint is unpaginated today and the server derives both from
    // the same slice, so the two agree, and `total` is the one that keeps agreeing
    // if paging is ever added.
    //
    // What the number means: the roster AS THIS OPERATOR MAY SEE IT. The server
    // narrows the reply to the hosts inside the caller's soul scope, so a narrow
    // scope legitimately shows fewer hosts than are bound. That is the contract,
    // not a miscount — hence a bare "hosts: N" and not "N hosts are bound".
    const memberHosts = roster.data?.total ?? null;
    return { stateKeys, memberHosts };
  }, [detail.data, roster.data]);

  // 403 is "you may not read this roster" and everything else is "it did not
  // arrive" — one is about the operator's permissions and the other about
  // retrying, so the card must not merge them into one apology.
  const rosterForbidden = roster.error instanceof ApiError && roster.error.status === 403;

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
          <Link to="/incarnations">incarnations</Link> / <span>{entityCaption(row)}</span>
        </div>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>{entityCaption(row)}</h1>
            {showsIdBeside(row) ? (
              <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{row.id}</div>
            ) : null}
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
                      incarnation: row.id,
                    });
                    navigate(`/run?${params.toString()}`);
                  }}
                  title={t('pages:runScenarioViaWizard')}
                >
                  <Play size={14} /> {t('runScenario')}
                </Button>
                <Button variant="secondary" onClick={() => setUpgradeOpen(true)} title={t('incarnations:actionUpgrade')}>
                  <ArrowUp size={14} /> {t('common:upgrade')}
                </Button>
                <Button variant="secondary" onClick={() => setTraitsOpen(true)} title={t('incarnations:editTraitsTitle')}>
                  <Tag size={14} /> {t('incarnations:editTraitsBtn')}
                </Button>
                <Button variant="secondary" onClick={() => setLabelOpen(true)}>
                  {t('forms:editLabelBtn')}
                </Button>
                <Button variant="danger" onClick={() => setDestroyOpen(true)} title={t('common:destroy')} data-testid="destroy-trigger">
                  <Trash size={14} /> {t('common:destroy')}
                </Button>
              </>
            ) : null}
            {isLocked ? (
              <>
                <Button variant="primary" onClick={() => setUnlockOpen(true)} title={t('incarnations:unlockTitleShort')}>
                  <Lock size={14} /> {t('common:unlock')}
                </Button>
                {row.status === 'error_locked' ? (
                  <Button
                    variant="secondary"
                    onClick={() => { setRerunAccepted(null); setRerunLastOpen(true); }}
                    title={t('incarnations:rerunLastTooltip')}
                    data-testid="rerun-last-trigger"
                  >
                    <RefreshCw size={14} /> {t('incarnations:rerunLastBtn')}
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
        <span className={styles.metaKey}>{t('common:colStatus')}</span>
        <span className={styles.metaVal}>
          <Badge tone={incarnationTone(row.status)}>{row.status}</Badge>
        </span>
        <span className={styles.metaKey}>{t('common:colCovens')}</span>
        <span className={styles.metaVal}>{(row.covens ?? []).length > 0 ? (row.covens ?? []).join(', ') : '—'}</span>
        <span className={styles.metaKey}>{t('incarnations:colTraits')}</span>
        <span className={styles.metaVal}>
          <TraitsChips traits={row.traits as Record<string, unknown> | null | undefined} />
        </span>
        <span className={styles.metaKey}>{t('common:colCreatedBy')}</span>
        <span className={styles.metaVal}>
          {row.created_by_aid
            ? <Link to={`/archons/${encodeURIComponent(row.created_by_aid)}`}>{row.created_by_aid}</Link>
            : <span style={{ color: 'var(--text-muted)' }}>—</span>
          }
        </span>
        <span className={styles.metaKey}>{t('common:colCreatedAt')}</span>
        <span className={styles.metaVal}>{row.created_at}</span>
        <span className={styles.metaKey}>{t('common:colUpdatedAt')}</span>
        <span className={styles.metaVal}>{row.updated_at}</span>
      </div>

      <div className={styles.tabs} role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'overview'} className={`${styles.tab} ${tab === 'overview' ? styles.tabActive : ''}`} onClick={() => setTab('overview')}>
          {t('incarnations:tabOverview')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'state'} className={`${styles.tab} ${tab === 'state' ? styles.tabActive : ''}`} onClick={() => setTab('state')}>
          <Activity size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />{t('incarnations:tabState')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'schema'} className={`${styles.tab} ${tab === 'schema' ? styles.tabActive : ''}`} onClick={() => setTab('schema')}>
          <Layers size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />{t('incarnations:tabSchema')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'hosts'} className={`${styles.tab} ${tab === 'hosts' ? styles.tabActive : ''}`} onClick={() => setTab('hosts')}>
          {t('incarnations:tabHosts')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'choirs'} className={`${styles.tab} ${tab === 'choirs' ? styles.tabActive : ''}`} onClick={() => setTab('choirs')}>
          {t('incarnations:tabChoirs')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'history'} className={`${styles.tab} ${tab === 'history' ? styles.tabActive : ''}`} onClick={() => setTab('history')}>
          <HistoryIcon size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />{t('incarnations:tabHistory')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'maintenance'} className={`${styles.tab} ${tab === 'maintenance' ? styles.tabActive : ''}`} onClick={() => setTab('maintenance')} data-testid="tab-maintenance">
          <CalendarClock size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />{t('incarnations:tabMaintenance')}
        </button>
      </div>

      {tab === 'overview' ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('incarnations:dataSummaryTitle')}</h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            {t('incarnations:dataSummaryDesc')} <strong>State</strong> {t('incarnations:dataSummaryStateTail')},{' '}
            <strong>Schema</strong> {t('incarnations:dataSummarySchemaTail')}, <strong>Hosts</strong> {t('incarnations:dataSummaryHostsTail')}
          </p>
          <div className={styles.summaryGrid}>
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
              {/* An ellipsis that never resolves is the card claiming to still be
                  working. A roster this operator may not read is a settled answer,
                  and the Add-Voice picker on this same page says so out loud — the
                  surface that shows the NUMBER must not be the one that stays
                  quiet about where the number went. */}
              <span className={styles.summaryCardValue} data-testid="hosts-card-value">
                {summary.memberHosts !== null
                  ? t('incarnations:hostsCardMembers', { n: summary.memberHosts })
                  : roster.error
                    ? t(
                        rosterForbidden
                          ? 'incarnations:hostsCardForbidden'
                          : 'incarnations:hostsCardUnreadable',
                      )
                    : t('incarnations:hostsCardLoading')}
              </span>
              <span className={styles.summaryCardHint}>{t('incarnations:hostsCardHint')}</span>
            </button>
          </div>

          {row.status_details ? (
            <>
              <h2 className={styles.sectionTitle} style={{ marginTop: 12 }}>{t('secStatusDetails')}</h2>
              <JsonViewer value={row.status_details} />
            </>
          ) : null}
        </section>
      ) : null}

      {tab === 'state' ? (
        <StateTab
          state={row.state ?? null}
          stateSchemaVersion={row.state_schema_version}
          incarnationName={row.id}
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
        <HostsTab incarnationName={row.id} state={row.state ?? null} />
      ) : null}

      {tab === 'choirs' ? (
        <ChoirsTab incarnationName={row.id} />
      ) : null}

      {tab === 'maintenance' ? (
        <MaintenanceTab incarnationName={row.id} />
      ) : null}

      {tab === 'history' ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('incarnations:tabHistory')}</h2>
          {deferredRows.length > 0 ? (
            <table className={styles.table} data-testid="incarnation-deferred-table">
              <thead>
                <tr>
                  <th>{t('colScenario')}</th>
                  <th>{t('colStatus')}</th>
                  <th>{t('runhistory:segVoyage')}</th>
                </tr>
              </thead>
              <tbody>
                {deferredRows.map((v) => (
                  <tr key={v.voyage_id} data-testid={`deferred-run-row-${v.voyage_id}`}>
                    <td className="mono">{v.scenario_name}</td>
                    <td>
                      <Badge tone={runStatusTone(v.status)}>{v.status}</Badge>
                      <DeferredUntil
                        voyageId={v.voyage_id}
                        scheduleAt={v.schedule_at as string}
                        invalidate={[['incarnation-deferred-runs', name], ['runs-feed', 'voyages']]}
                      />
                    </td>
                    <td className="mono">
                      <Link to={`/voyages/${encodeURIComponent(v.voyage_id)}`}>{v.voyage_id}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
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
            <table className={styles.table} data-testid="incarnation-runs-table">
              <thead>
                <tr>
                  <th>{t('colScenario')}</th>
                  <th>{t('colStatus')}</th>
                  <th>{t('common:colApplyId')}</th>
                  <th>{t('common:colStartedBy')}</th>
                  <th>{t('common:colStartedAt')}</th>
                  <th>{t('common:colFinishedAt')}</th>
                </tr>
              </thead>
              <tbody>
                {(history.data.items ?? []).map((run) => (
                  <tr key={run.apply_id} data-testid={`history-run-row-${run.apply_id}`}>
                    <td className="mono">{run.scenario}</td>
                    <td>
                      <Badge tone={runStatusTone(run.status)}>{run.status}</Badge>
                    </td>
                    <td className="mono">
                      {/* apply_id is the apply_run (create/rerun-last/operational scenario),
                          NOT a Voyage (batch run across many incarnations). Reference the
                          run view of this incarnation. */}
                      <Link
                        to={`/incarnations/${encodeURIComponent(name)}/runs/${encodeURIComponent(run.apply_id)}`}
                        title={t('incarnations:historyApplyIdLink')}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        data-testid={`history-apply-link-${run.apply_id}`}
                      >
                        {run.apply_id}
                        <ExternalLink size={11} style={{ opacity: 0.6, flexShrink: 0 }} />
                      </Link>
                    </td>
                    <td className="mono">
                      {run.started_by_aid ? (
                        <Link to={`/archons/${encodeURIComponent(run.started_by_aid)}`}>
                          {run.started_by_aid}
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="mono">{run.started_at}</td>
                    <td className="mono">{run.finished_at ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}

      {rerunAccepted ? (
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
          {t('incarnations:rerunLastAccepted', { scenario: rerunAccepted.scenario })}{' '}
          <span className="mono">{rerunAccepted.apply_id}</span>
          <button
            type="button"
            onClick={() => setRerunAccepted(null)}
            aria-label={t('cancel')}
            style={{ marginLeft: 12, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14 }}
          >
            ×
          </button>
        </div>
      ) : null}
      <EditLabelModal
        open={labelOpen}
        onClose={() => setLabelOpen(false)}
        id={row.id}
        label={row.label}
        setLabel={(body) => keeperApi.incarnations.setLabel(row.id, body)}
        invalidate={[['incarnation', row.id], ['incarnations.list']]}
        idHint={t('forms:idImmutableIncarnation')}
      />
      <IncarnationTraitsModal
        open={traitsOpen}
        incarnationName={row.id}
        currentTraits={row.traits as Record<string, unknown> | null | undefined}
        onClose={() => setTraitsOpen(false)}
      />
      <UnlockModal open={unlockOpen} incarnationName={row.id} onClose={() => setUnlockOpen(false)} />
      <RerunLastModal
        open={rerunLastOpen}
        incarnationName={row.id}
        onClose={() => setRerunLastOpen(false)}
        onAccepted={(reply) => setRerunAccepted(reply)}
      />
      <UpgradeModal
        open={upgradeOpen}
        incarnationName={row.id}
        serviceName={row.service}
        currentRef={row.service_version}
        onClose={() => setUpgradeOpen(false)}
      />
      <DestroyModal open={destroyOpen} incarnationName={row.id} onClose={() => setDestroyOpen(false)} />
    </div>
  );
}
