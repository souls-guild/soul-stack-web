import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Activity, ChevronDown, ChevronRight } from 'lucide-react';
import { Button, Dot, Sparkline } from '../../components/primitives';
import { KeeperSidCell } from '../../components/KeeperSidCell';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import common from '../common.module.css';
import styles from './HostUtilizationPanel.module.css';
import {
  ageSeconds,
  busiestDisk,
  formatLoad,
  formatMb,
  formatPct,
  formatUptime,
  ratioPct,
  skewMinutes,
  utilTone,
  type VitalsTone,
} from './hostVitals';

// Под-панель Host-Utilization (NIM-88, эпик NIM-85). Обзор — агрегат по хостам
// инкарнации (latest+stale, без окна); спарклайны+skew — per-soul по требованию
// (окно есть только в soul-эндпоинте). Свежесть — по backend-флагу stale (TTL уже
// посчитан сервером), не выдаём протухшее за свежее; нет latest → graceful «нет данных».
const REFETCH_MS = 15000;

const meterTone: Record<VitalsTone, string> = {
  ok: styles.meter_ok,
  warn: styles.meter_warn,
  danger: styles.meter_danger,
};

export function HostUtilizationPanel({ incarnationName }: { incarnationName: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<string | null>(null);
  const now = Date.now();

  const q = useQuery({
    queryKey: ['incarnation-telemetry', incarnationName],
    queryFn: () => keeperApi.incarnations.telemetry(incarnationName),
    enabled: Boolean(incarnationName),
    retry: false,
    refetchInterval: REFETCH_MS,
  });

  const status = q.error instanceof ApiError ? q.error.status : null;
  const forbidden = status === 403;
  // 404/501 — эндпоинт telemetry не задеплоен (старый Keeper) → мягкая деградация,
  // не красный error-box (CLAUDE.md #3); симметрично soul-стороне.
  const unavailable = status === 404 || status === 501;
  const hosts = q.data?.hosts ?? [];

  return (
    <>
      <h2 className={common.sectionTitle} style={{ marginTop: 16 }}>
        <Activity size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
        Host utilization
      </h2>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>{t('incarnations:utilDesc')}</p>

      {q.isLoading ? <div className={common.loading}>{t('loading')}</div> : null}
      {forbidden ? (
        <div className={common.empty} data-testid="util-forbidden">
          {t('incarnations:utilForbidden')}
        </div>
      ) : null}
      {unavailable ? (
        <div className={common.empty} data-testid="util-unavailable">
          {t('incarnations:utilUnavailable')}
        </div>
      ) : null}
      {q.error && !forbidden && !unavailable ? (
        <div className={common.errorBox}>
          {t('incarnations:utilLoadFailed', { detail: String(q.error) })}
        </div>
      ) : null}

      {q.data && hosts.length === 0 ? (
        <div className={common.empty} data-testid="util-empty">
          {t('incarnations:utilEmpty')}
        </div>
      ) : null}

      {hosts.length > 0 ? (
        <table className={common.table}>
          <thead>
            <tr>
              <th>Host</th>
              <th>Fresh</th>
              <th>CPU</th>
              <th>Mem</th>
              <th>Disk</th>
              <th>Load</th>
              <th>Uptime</th>
              <th style={{ width: 1 }} />
            </tr>
          </thead>
          <tbody>
            {hosts.map((h) => {
              const l = h.latest;
              const open = expanded === h.sid;
              const disk = l ? busiestDisk(l.disks) : null;
              const memPct = l ? ratioPct(l.mem_used_mb, l.mem_total_mb) : null;
              return (
                <Fragment key={h.sid}>
                  <tr>
                    <td className="mono">
                      <KeeperSidCell sid={h.sid} />
                    </td>
                    <td>
                      <Freshness stale={h.stale} collectedAt={h.collected_at} hasData={Boolean(l)} now={now} />
                    </td>
                    {l ? (
                      <>
                        <td>
                          <MetricCell value={formatPct(l.cpu_pct)} pct={l.cpu_pct} tone={utilTone(l.cpu_pct)} />
                        </td>
                        <td>
                          <MetricCell
                            value={`${formatMb(l.mem_used_mb)} / ${formatMb(l.mem_total_mb)}`}
                            pct={memPct}
                            tone={utilTone(memPct)}
                          />
                        </td>
                        <td title={disk?.mount}>
                          {disk ? (
                            <MetricCell value={formatPct(disk.pct)} pct={disk.pct} tone={utilTone(disk.pct)} />
                          ) : (
                            '—'
                          )}
                        </td>
                        <td
                          className="mono"
                          title={`1m ${formatLoad(l.load1)} · 5m ${formatLoad(l.load5)} · 15m ${formatLoad(l.load15)}`}
                        >
                          {formatLoad(l.load1)}
                        </td>
                        <td className="mono">{formatUptime(l.uptime_sec)}</td>
                        <td>
                          <Button
                            type="button"
                            variant="ghost"
                            aria-label={t(open ? 'incarnations:utilCollapseAria' : 'incarnations:utilExpandAria', {
                              sid: h.sid,
                            })}
                            onClick={() => setExpanded(open ? null : h.sid)}
                          >
                            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </Button>
                        </td>
                      </>
                    ) : (
                      <td colSpan={6} className={styles.mutedCell}>
                        —
                      </td>
                    )}
                  </tr>
                  {open && l ? (
                    <tr className={styles.sparkRow}>
                      <td colSpan={8}>
                        <HostSparklines sid={h.sid} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      ) : null}

      {q.data?.truncated ? (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>{t('incarnations:utilTruncated')}</p>
      ) : null}
    </>
  );
}

function Freshness({
  stale,
  collectedAt,
  hasData,
  now,
}: {
  stale: boolean;
  collectedAt?: string;
  hasData: boolean;
  now: number;
}) {
  const { t } = useTranslation();
  if (!hasData) {
    return (
      <span className={styles.freshness} data-testid="freshness-nodata">
        <Dot kind="off" /> {t('incarnations:utilNoData')}
      </span>
    );
  }
  if (stale) {
    return (
      <span className={styles.freshness} data-testid="freshness-stale">
        <Dot kind="warn" /> {t('incarnations:utilStale')}
      </span>
    );
  }
  const age = ageSeconds(collectedAt, now);
  let ageText = '—';
  if (age != null) {
    const [key, n] = ageBucket(age);
    ageText = t(key, { n });
  }
  return (
    <span className={styles.freshness} data-testid="freshness-fresh">
      <Dot kind="ok" title={collectedAt} /> {ageText}
    </span>
  );
}

function ageBucket(sec: number): [key: string, n: number] {
  if (sec < 60) return ['souls:timeAgoSeconds', sec];
  const m = Math.floor(sec / 60);
  if (m < 60) return ['souls:timeAgoMinutes', m];
  const h = Math.floor(m / 60);
  if (h < 24) return ['souls:timeAgoHours', h];
  return ['souls:timeAgoDays', Math.floor(h / 24)];
}

function MetricCell({ value, pct, tone }: { value: string; pct?: number | null; tone?: VitalsTone }) {
  return (
    <div className={styles.metricCell}>
      <span className={styles.metricValue}>{value}</span>
      {pct != null ? (
        <div className={styles.meterOuter}>
          <div
            className={`${styles.meterInner} ${meterTone[tone ?? 'ok']}`}
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

// Спарклайны+skew конкретного хоста — отдельный per-soul запрос (окно есть только
// в soul-эндпоинте). Монтируется лишь когда строка развёрнута → нет N-polling.
function HostSparklines({ sid }: { sid: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['soul-telemetry', sid],
    queryFn: () => keeperApi.souls.telemetry(sid),
    enabled: Boolean(sid),
    retry: false,
    refetchInterval: REFETCH_MS,
  });

  if (q.isLoading) return <div className={styles.sparkLoading}>{t('loading')}</div>;
  if (q.error) {
    const soft = q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404);
    return (
      <div className={soft ? styles.sparkMuted : styles.sparkError}>
        {t('incarnations:utilWindowFailed', { detail: String(q.error) })}
      </div>
    );
  }

  const data = q.data;
  const win = [...(data?.window ?? [])].reverse(); // API newest-first → хронологически
  const skew = skewMinutes(data?.collected_at, data?.received_at);
  if (win.length === 0) {
    return (
      <div className={styles.sparkMuted} data-testid="spark-empty">
        {t('incarnations:utilWindowEmpty')}
      </div>
    );
  }

  const cpu = win.map((p) => p.cpu_pct);
  const mem = win.map((p) => ratioPct(p.mem_used_mb, p.mem_total_mb) ?? 0);
  const load1 = win.map((p) => p.load1);
  const lastCpu = cpu[cpu.length - 1];
  const lastMem = mem[mem.length - 1];

  return (
    <div className={styles.sparkGrid}>
      <SparkBlock label="CPU" value={formatPct(lastCpu)} values={cpu} min={0} max={100} tone={utilTone(lastCpu)} testId="spark-cpu" />
      <SparkBlock label="Mem" value={formatPct(lastMem)} values={mem} min={0} max={100} tone={utilTone(lastMem)} testId="spark-mem" />
      <SparkBlock label="Load1" value={formatLoad(load1[load1.length - 1])} values={load1} tone="accent" testId="spark-load" />
      {skew != null ? <div className={styles.skew}>{t('souls:skewWarning', { minutes: skew })}</div> : null}
    </div>
  );
}

function SparkBlock({
  label,
  value,
  values,
  min,
  max,
  tone,
  testId,
}: {
  label: string;
  value: string;
  values: number[];
  min?: number;
  max?: number;
  tone: VitalsTone | 'accent';
  testId: string;
}) {
  return (
    <div className={styles.sparkBlock}>
      <span className={styles.sparkLabel}>
        {label}
        <span className={styles.sparkValue}>{value}</span>
      </span>
      <Sparkline values={values} min={min} max={max} tone={tone} ariaLabel={`${label} ${value}`} testId={testId} />
    </div>
  );
}
