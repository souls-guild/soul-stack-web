import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Boxes, Package, Radio } from 'lucide-react';
import { keeperApi, type ServiceStatsEntry, type SoulStatus, type Voyage } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Donut, type DonutSlice, type DonutTone } from '../../components/primitives';
import { runStatusTone } from '../../components/status';
import styles from '../common.module.css';
import donutStyles from './OverviewDonuts.module.css';

// Dashboard counter with an icon, value, and link to the list.
function StatCard({
  label,
  value,
  hint,
  to,
  loading,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  to: string;
  loading: boolean;
  icon: typeof Boxes;
}) {
  return (
    <Link to={to} className={styles.summaryCard} style={{ textDecoration: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
        <Icon size={14} />
        <span className={styles.summaryCardLabel}>{label}</span>
      </div>
      <span className={styles.summaryCardValue}>
        {loading ? '…' : value}
      </span>
      {hint ? <span className={styles.summaryCardHint}>{hint}</span> : null}
    </Link>
  );
}

// Row in the recent runs table.
interface RecentRun {
  id: string;
  kind: string;
  status: string;
  startedAt?: string;
  to: string;
  target?: string;
}

function formatRelative(iso: string | undefined): string {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  const deltaSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86_400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return `${Math.floor(deltaSec / 86_400)}d ago`;
}

// Tone for the soul status donut/legend. connected=ok(green), pending=warn(yellow),
// disconnected/revoked/expired=danger(red, "error-like"), destroyed/unknown=muted.
// We don't reuse soulTone() from components/status — that function shares badge-tone
// with other pages (SoulsList/SoulDetail) and marks pending as muted (not warn)
// in a different contrast; this is its own donut-segment palette specific to this page.
function statusDonutTone(status: string): DonutTone {
  switch (status as SoulStatus) {
    case 'connected':
      return 'ok';
    case 'pending':
      return 'warn';
    case 'disconnected':
    case 'revoked':
    case 'expired':
      return 'danger';
    default:
      return 'muted';
  }
}

// One tone per slice: past five services the tail folds into one muted "other"
// slice, because a cycled palette would give two services one colour. `ok` is left
// out on purpose — in every theme it is a green next to the teal `accent`.
const SERVICE_PALETTE: DonutTone[] = ['accent', 'info', 'warn', 'danger', 'muted'];
const OTHER_SLICE_KEY = '__other__';

function statusMapToSlices(byStatus: Record<string, number>): DonutSlice[] {
  return Object.entries(byStatus)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => ({ key: status, label: status, value: count, tone: statusDonutTone(status) }));
}

function serviceIncarnationSlices(entries: ServiceStatsEntry[], otherLabel: string): DonutSlice[] {
  const sorted = entries
    .filter((e) => e.incarnations > 0)
    .sort((a, b) => b.incarnations - a.incarnations || a.service.localeCompare(b.service));
  const shown = sorted.length > SERVICE_PALETTE.length ? sorted.slice(0, SERVICE_PALETTE.length - 1) : sorted;
  const slices: DonutSlice[] = shown.map((e, i) => ({
    key: e.service,
    label: e.service,
    value: e.incarnations,
    tone: SERVICE_PALETTE[i],
  }));
  const rest = sorted.slice(shown.length);
  if (rest.length > 0) {
    slices.push({
      key: OTHER_SLICE_KEY,
      label: otherLabel,
      value: rest.reduce((sum, e) => sum + e.incarnations, 0),
      tone: 'muted',
    });
  }
  return slices;
}

function ServiceHostsBars({ entries }: { entries: ServiceStatsEntry[] }) {
  const sorted = [...entries].sort((a, b) => b.hosts - a.hosts || a.service.localeCompare(b.service));
  const max = Math.max(1, ...sorted.map((e) => e.hosts));
  return (
    <ul className={donutStyles.bars}>
      {sorted.map((e) => (
        <li key={e.service} className={donutStyles.barRow} data-testid={`hosts-bar-${e.service}`}>
          <Link to={`/services/${encodeURIComponent(e.service)}`} className={`${donutStyles.barLabel} mono`}>
            {e.service}
          </Link>
          <span className={donutStyles.barTrack}>
            <span className={donutStyles.barFill} style={{ width: `${(e.hosts / max) * 100}%` }} />
          </span>
          <span className={donutStyles.barValue}>{e.hosts}</span>
        </li>
      ))}
    </ul>
  );
}

function QueryError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  return (
    <div className={styles.errorBox}>
      {error instanceof ApiError
        ? t('errors:generic', { status: error.status, detail: error.message })
        : String(error)}
    </div>
  );
}

export function OverviewPage() {
  const { t } = useTranslation();

  const soulsStatsQ = useQuery({
    queryKey: ['overview.souls.stats'],
    queryFn: () => keeperApi.souls.stats(),
    staleTime: 15_000,
  });

  // HA topology of the Keeper cluster + self_health.
  const clusterQ = useQuery({
    queryKey: ['overview.cluster'],
    queryFn: () => keeperApi.cluster.get(),
    staleTime: 15_000,
  });

  // Incarnations — total and count by status.
  const incarnationsQ = useQuery({
    queryKey: ['overview.incarnations'],
    queryFn: () => keeperApi.incarnations.list({ limit: 1 }),
    staleTime: 30_000,
  });
  const incarnationsApplying = useQuery({
    queryKey: ['overview.incarnations.applying'],
    queryFn: () => keeperApi.incarnations.list({ status: 'applying', limit: 1 }),
    staleTime: 15_000,
  });

  const servicesQ = useQuery({
    queryKey: ['overview.services'],
    queryFn: () => keeperApi.services.list(),
    staleTime: 30_000,
  });
  const serviceStatsQ = useQuery({
    queryKey: ['overview.stats.services'],
    queryFn: () => keeperApi.stats.services(),
    staleTime: 15_000,
  });

  // Voyages — last 5 (for the "recent runs" section).
  const voyagesRecent = useQuery({
    queryKey: ['overview.voyages.recent'],
    queryFn: () => keeperApi.voyages.list({ limit: 5 }),
    staleTime: 15_000,
  });

  const incarnationsTotal = incarnationsQ.data?.total ?? 0;
  const incarnationsApplyingCount = incarnationsApplying.data?.total ?? 0;

  const byStatus = soulsStatsQ.data?.by_status ?? {};
  const byTransport = soulsStatsQ.data?.by_transport ?? {};
  const soulsTotal = soulsStatsQ.data?.total ?? 0;
  // agent->pull, ssh->push (backend transport vocabulary, UI labels see /v1/souls/stats description).
  const pullCount = byTransport['agent'] ?? 0;
  const pushCount = byTransport['ssh'] ?? 0;
  const servicesCount = servicesQ.data?.items?.length ?? 0;
  const byService = serviceStatsQ.data?.by_service ?? [];

  const statusSlices = statusMapToSlices(byStatus);
  const serviceSlices = serviceIncarnationSlices(byService, t('pages:overviewOtherServices'));

  const recentRuns: RecentRun[] = ((voyagesRecent.data?.items ?? []) as Voyage[]).map((v) => {
    // Show a short target: for scenario — the first incarnation from target.incarnations,
    // for command — the first coven or a where-fragment.
    const targetLabel =
      v.target?.incarnations?.[0] ??
      v.target?.coven?.[0] ??
      v.scenario_name ??
      undefined;
    return {
      id: v.voyage_id,
      kind: v.kind,
      status: v.status,
      startedAt: v.started_at,
      to: `/voyages/${encodeURIComponent(v.voyage_id)}`,
      target: targetLabel,
    };
  });

  // Whether there are errors — show degradation, not a crash.
  const hasError =
    soulsStatsQ.isError || clusterQ.isError || incarnationsQ.isError || servicesQ.isError || serviceStatsQ.isError;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('secOverview')}</h1>
          <div className={styles.crumbs}>{t('pages:overviewCrumbs')}</div>
        </div>
      </div>

      {hasError ? (
        <div className={styles.errorBox} role="alert">
          {t('pages:overviewPartialError')}
        </div>
      ) : null}

      {/* Counters */}
      <section className={styles.section} aria-label={t('pages:overviewCounters')}>
        <div className={styles.summaryGrid}>
          <StatCard
            label={t('pages:overviewTransport')}
            value={`${pullCount} / ${pushCount}`}
            hint={t('pages:overviewTransportHint')}
            to="/souls"
            loading={soulsStatsQ.isLoading}
            icon={Radio}
          />
          <StatCard
            label={t('pages:overviewServicesCount')}
            value={servicesCount}
            hint={t('pages:overviewServicesHint')}
            to="/services"
            loading={servicesQ.isLoading}
            icon={Package}
          />
          <StatCard
            label={t('pages:overviewIncarnations')}
            value={incarnationsTotal}
            hint={
              incarnationsApplyingCount > 0
                ? t('pages:overviewIncarnationsApplying', { count: incarnationsApplyingCount })
                : undefined
            }
            to="/incarnations"
            loading={incarnationsQ.isLoading}
            icon={Boxes}
          />
        </div>
      </section>

      <section className={styles.section} aria-label={t('pages:overviewCharts')}>
        <div className={donutStyles.donutGrid}>
          <div className={donutStyles.donutCard}>
            <h2 className={styles.sectionTitle}>{t('pages:overviewStatusDonutTitle')}</h2>
            {soulsStatsQ.isLoading ? (
              <div className={styles.loading}>{t('loading')}</div>
            ) : soulsStatsQ.error ? (
              <QueryError error={soulsStatsQ.error} />
            ) : statusSlices.length === 0 ? (
              <div className={styles.empty}>{t('pages:overviewNoSouls')}</div>
            ) : (
              <Donut slices={statusSlices} centerValue={soulsTotal} centerLabel={t('pages:overviewSoulsTotal')} />
            )}
          </div>
          <div className={donutStyles.donutCard} data-testid="overview-incarnations-by-service">
            <h2 className={styles.sectionTitle}>{t('pages:overviewIncByServiceTitle')}</h2>
            {serviceStatsQ.isLoading ? (
              <div className={styles.loading}>{t('loading')}</div>
            ) : serviceStatsQ.error ? (
              <QueryError error={serviceStatsQ.error} />
            ) : serviceSlices.length === 0 ? (
              <div className={styles.empty}>{t('pages:overviewNoIncarnations')}</div>
            ) : (
              <Donut
                slices={serviceSlices}
                centerLabel={t('pages:overviewSoulsTotal')}
                legendBelow
                totalLabel={t('pages:overviewIncTotal')}
              />
            )}
          </div>
          <div className={donutStyles.donutCard} data-testid="overview-hosts-by-service">
            <h2 className={styles.sectionTitle}>{t('pages:overviewHostsByServiceTitle')}</h2>
            {serviceStatsQ.isLoading ? (
              <div className={styles.loading}>{t('loading')}</div>
            ) : serviceStatsQ.error ? (
              <QueryError error={serviceStatsQ.error} />
            ) : byService.length === 0 ? (
              <div className={styles.empty}>{t('pages:overviewNoIncarnations')}</div>
            ) : (
              <ServiceHostsBars entries={byService} />
            )}
          </div>
        </div>
      </section>

      {/* SelfCheck: Keeper cluster HA topology */}
      <section className={styles.section} aria-label={t('pages:overviewClusterTitle')}>
        <h2 className={styles.sectionTitle}>{t('pages:overviewClusterTitle')}</h2>
        {clusterQ.isLoading ? (
          <div className={styles.loading}>{t('loading')}</div>
        ) : clusterQ.error ? (
          <div className={styles.errorBox}>
            {clusterQ.error instanceof ApiError
              ? t('errors:generic', { status: clusterQ.error.status, detail: clusterQ.error.message })
              : String(clusterQ.error)}
          </div>
        ) : (
          <div className={donutStyles.clusterWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('common:colKid')}</th>
                  <th>{t('pages:overviewClusterStarted')}</th>
                  <th>{t('pages:overviewClusterStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {(clusterQ.data?.instances ?? []).map((inst) => (
                  <tr key={inst.kid}>
                    <td className="mono">
                      {inst.kid}
                      {inst.kid === clusterQ.data?.self_kid ? (
                        <span className={donutStyles.selfMarker}> {t('pages:overviewClusterSelfMarker')}</span>
                      ) : null}
                    </td>
                    <td className="mono">{formatRelative(inst.started_at)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Badge tone={inst.alive ? 'ok' : 'danger'}>
                          {inst.alive ? t('pages:overviewClusterAlive') : t('pages:overviewClusterDead')}
                        </Badge>
                        {inst.is_reaper_leader ? (
                          <Badge tone="info">{t('pages:overviewClusterReaperLeader')}</Badge>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {(clusterQ.data?.instances ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={3} className={styles.empty}>
                      {t('pages:overviewClusterEmpty')}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>

            <div className={donutStyles.selfHealth}>
              <span className={donutStyles.selfHealthLabel}>{t('pages:overviewSelfHealthTitle')}</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Object.entries(clusterQ.data?.self_health ?? {}).map(([component, status]) => {
                  // Contract (keeper/internal/api/handlers/cluster.go): the value is either
                  // the literal "ok", or an arbitrary failure-reason string (title on the badge).
                  const ok = status === 'ok';
                  return (
                    <Badge key={component} tone={ok ? 'ok' : 'danger'} title={ok ? undefined : status}>
                      {component}: {ok ? '✓' : '✗'}
                    </Badge>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Recent runs */}
      <section className={styles.section} aria-label={t('pages:overviewRecentRuns')}>
        <h2 className={styles.sectionTitle}>{t('pages:overviewRecentRuns')}</h2>
        {voyagesRecent.isLoading ? (
          <div className={styles.loading}>{t('loading')}</div>
        ) : voyagesRecent.error ? (
          <div className={styles.errorBox}>
            {voyagesRecent.error instanceof ApiError
              ? t('errors:generic', {
                  status: voyagesRecent.error.status,
                  detail: voyagesRecent.error.message,
                })
              : String(voyagesRecent.error)}
          </div>
        ) : recentRuns.length === 0 ? (
          <div className={styles.empty}>{t('pages:overviewNoRuns')}</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('common:colId')}</th>
                <th>{t('colKind')}</th>
                <th>{t('colTarget')}</th>
                <th>{t('colStatus')}</th>
                <th>{t('colStarted')}</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={r.to} className="mono" style={{ fontSize: 12 }}>
                      {r.id.length > 16 ? `${r.id.slice(0, 16)}…` : r.id}
                    </Link>
                  </td>
                  <td className="mono">{r.kind}</td>
                  <td className="mono">{r.target ?? '—'}</td>
                  <td>
                    <Badge tone={runStatusTone(r.status)}>{r.status}</Badge>
                  </td>
                  <td className="mono">{formatRelative(r.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <Link
            to="/runs"
            style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}
          >
            {t('pages:overviewAllRuns')} →
          </Link>
        </div>
      </section>
    </div>
  );
}
