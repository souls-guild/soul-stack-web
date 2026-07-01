import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, Boxes, Package, Users } from 'lucide-react';
import { keeperApi, type Voyage } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge } from '../../components/primitives';
import { runStatusTone } from '../../components/status';
import styles from '../common.module.css';

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

export function OverviewPage() {
  const { t } = useTranslation();

  // Souls — total и connected (status=connected).
  const soulsAll = useQuery({
    queryKey: ['overview.souls.all'],
    queryFn: () => keeperApi.souls.list({ limit: 1 }),
    staleTime: 30_000,
  });
  const soulsConnected = useQuery({
    queryKey: ['overview.souls.connected'],
    queryFn: () => keeperApi.souls.list({ status: 'connected', limit: 1 }),
    staleTime: 30_000,
  });

  // Services — total.
  const servicesQ = useQuery({
    queryKey: ['overview.services'],
    queryFn: () => keeperApi.services.list(),
    staleTime: 60_000,
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

  // Voyages — активные (running/pending) и последние 5.
  const voyagesActive = useQuery({
    queryKey: ['overview.voyages.active'],
    queryFn: () => keeperApi.voyages.list({ status: ['running', 'pending'], limit: 1 }),
    staleTime: 15_000,
  });
  const voyagesRecent = useQuery({
    queryKey: ['overview.voyages.recent'],
    queryFn: () => keeperApi.voyages.list({ limit: 5 }),
    staleTime: 15_000,
  });

  const soulsTotal = soulsAll.data?.total ?? 0;
  const soulsConnectedCount = soulsConnected.data?.total ?? 0;
  const servicesTotal = servicesQ.data?.items?.length ?? 0;
  const incarnationsTotal = incarnationsQ.data?.total ?? 0;
  const incarnationsApplyingCount = incarnationsApplying.data?.total ?? 0;
  const voyagesActiveCount = voyagesActive.data?.total ?? 0;

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
  const hasError =
    soulsAll.isError || servicesQ.isError || incarnationsQ.isError;

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
            label={t('pages:overviewSoulsConnected')}
            value={`${soulsConnectedCount} / ${soulsTotal}`}
            hint={t('pages:overviewSoulsHint')}
            to="/souls"
            loading={soulsAll.isLoading || soulsConnected.isLoading}
            icon={Users}
          />
          <StatCard
            label={t('pages:overviewServices')}
            value={servicesTotal}
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
          <StatCard
            label={t('pages:overviewActiveRuns')}
            value={voyagesActiveCount}
            hint={voyagesActiveCount > 0 ? t('pages:overviewActiveRunsHint') : undefined}
            to="/runs"
            loading={voyagesActive.isLoading}
            icon={Activity}
          />
        </div>
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
