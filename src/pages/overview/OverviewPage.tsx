import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, Boxes, Radio, Tags } from 'lucide-react';
import { keeperApi, type SoulStatus, type Voyage } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Donut, type DonutSlice, type DonutTone } from '../../components/primitives';
import { runStatusTone } from '../../components/status';
import styles from '../common.module.css';
import donutStyles from './OverviewDonuts.module.css';

// Дашборд-счётчик с иконкой, значением и ссылкой на список.
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

// Строка в таблице последних прогонов.
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

// Tone souls-статуса для donut/legend. connected=ok(зелёный), pending=warn(жёлтый),
// disconnected/revoked/expired=danger(красный, "error-подобные"), destroyed/неизвестный=muted.
// Не переиспользуем soulTone() из components/status — та функция шарит badge-tone
// с другими страницами (SoulsList/SoulDetail) и в другом контрасте помечает
// pending как muted, а не warn; здесь своя, ТЗ-специфичная палитра donut-сегментов.
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

// Coven-донат не имеет статусной семантики — цикличная нейтральная палитра
// по индексу, чтобы соседние сегменты визуально различались.
const COVEN_PALETTE: DonutTone[] = ['accent', 'info', 'warn', 'ok', 'danger', 'muted'];

function statusMapToSlices(byStatus: Record<string, number>): DonutSlice[] {
  return Object.entries(byStatus)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => ({ key: status, label: status, value: count, tone: statusDonutTone(status) }));
}

function covenMapToSlices(byCoven: Record<string, number>): DonutSlice[] {
  return Object.entries(byCoven)
    .sort((a, b) => b[1] - a[1])
    .map(([coven, count], i) => ({
      key: coven,
      label: coven,
      value: count,
      tone: COVEN_PALETTE[i % COVEN_PALETTE.length],
    }));
}

export function OverviewPage() {
  const { t } = useTranslation();

  // Souls — сводка по статусам/транспорту/coven одним запросом (ADR-047 scoped).
  const soulsStatsQ = useQuery({
    queryKey: ['overview.souls.stats'],
    queryFn: () => keeperApi.souls.stats(),
    staleTime: 15_000,
  });

  // HA-топология Keeper-кластера + self_health.
  const clusterQ = useQuery({
    queryKey: ['overview.cluster'],
    queryFn: () => keeperApi.cluster.get(),
    staleTime: 15_000,
  });

  // Incarnations — total и count по статусам.
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

  // Voyages — последние 5 (для секции «последние прогоны»).
  const voyagesRecent = useQuery({
    queryKey: ['overview.voyages.recent'],
    queryFn: () => keeperApi.voyages.list({ limit: 5 }),
    staleTime: 15_000,
  });

  const incarnationsTotal = incarnationsQ.data?.total ?? 0;
  const incarnationsApplyingCount = incarnationsApplying.data?.total ?? 0;

  const byStatus = soulsStatsQ.data?.by_status ?? {};
  const byTransport = soulsStatsQ.data?.by_transport ?? {};
  const byCoven = soulsStatsQ.data?.by_coven ?? {};
  const soulsTotal = soulsStatsQ.data?.total ?? 0;
  const staleCount = soulsStatsQ.data?.stale_count ?? 0;
  const covensCount = Object.keys(byCoven).length;
  // agent→pull, ssh→push (backend-словарь transport, UI-лейблы см. описание /v1/souls/stats).
  const pullCount = byTransport['agent'] ?? 0;
  const pushCount = byTransport['ssh'] ?? 0;

  const statusSlices = statusMapToSlices(byStatus);
  const covenSlices = covenMapToSlices(byCoven);

  const recentRuns: RecentRun[] = ((voyagesRecent.data?.items ?? []) as Voyage[]).map((v) => {
    // Показываем краткий target: для scenario — первая инкарнация из target.incarnations,
    // для command — первый coven или where-фрагмент.
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

  // Есть ли ошибки — показываем деградацию, не краш.
  const hasError = soulsStatsQ.isError || clusterQ.isError || incarnationsQ.isError;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Overview</h1>
          <div className={styles.crumbs}>{t('pages:overviewCrumbs')}</div>
        </div>
      </div>

      {hasError ? (
        <div className={styles.errorBox} role="alert">
          {t('pages:overviewPartialError')}
        </div>
      ) : null}

      {/* Счётчики */}
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
            label={t('pages:overviewCovensCount')}
            value={covensCount}
            to="/souls"
            loading={soulsStatsQ.isLoading}
            icon={Tags}
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
          <StatCard
            label={t('pages:overviewStaleCount')}
            value={staleCount}
            hint={t('pages:overviewStaleHint')}
            to="/souls"
            loading={soulsStatsQ.isLoading}
            icon={Activity}
          />
        </div>
      </section>

      {/* Souls: 2 donut (статус + coven) */}
      <section className={styles.section} aria-label={t('pages:overviewSoulsCharts')}>
        <div className={donutStyles.donutGrid}>
          <div className={donutStyles.donutCard}>
            <h2 className={styles.sectionTitle}>{t('pages:overviewStatusDonutTitle')}</h2>
            {soulsStatsQ.isLoading ? (
              <div className={styles.loading}>{t('loading')}</div>
            ) : soulsStatsQ.error ? (
              <div className={styles.errorBox}>
                {soulsStatsQ.error instanceof ApiError
                  ? t('errors:generic', { status: soulsStatsQ.error.status, detail: soulsStatsQ.error.message })
                  : String(soulsStatsQ.error)}
              </div>
            ) : statusSlices.length === 0 ? (
              <div className={styles.empty}>{t('pages:overviewNoSouls')}</div>
            ) : (
              <Donut slices={statusSlices} centerValue={soulsTotal} centerLabel={t('pages:overviewSoulsTotal')} />
            )}
          </div>
          <div className={donutStyles.donutCard}>
            <h2 className={styles.sectionTitle}>{t('pages:overviewCovenDonutTitle')}</h2>
            {soulsStatsQ.isLoading ? (
              <div className={styles.loading}>{t('loading')}</div>
            ) : soulsStatsQ.error ? (
              <div className={styles.errorBox}>
                {soulsStatsQ.error instanceof ApiError
                  ? t('errors:generic', { status: soulsStatsQ.error.status, detail: soulsStatsQ.error.message })
                  : String(soulsStatsQ.error)}
              </div>
            ) : covenSlices.length === 0 ? (
              <div className={styles.empty}>{t('pages:overviewNoCovens')}</div>
            ) : (
              <Donut slices={covenSlices} centerValue={soulsTotal} centerLabel={t('pages:overviewSoulsTotal')} />
            )}
          </div>
        </div>
      </section>

      {/* SelfCheck: HA-топология Keeper-кластера */}
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
                  <th>KID</th>
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
                  // Контракт (keeper/internal/api/handlers/cluster.go): значение — либо
                  // литерал "ok", либо произвольная строка-причина сбоя (title на badge).
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

      {/* Последние прогоны */}
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
                <th>ID</th>
                <th>Kind</th>
                <th>Target</th>
                <th>Status</th>
                <th>Started</th>
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
