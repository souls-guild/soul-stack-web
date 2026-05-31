import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Key, Shield, Terminal } from 'lucide-react';
import i18n from '../../i18n';
import { Badge, Button, Dot, Pager } from '../../components/primitives';
import { soulDot, soulTone } from '../../components/status';
import {
  keeperApi,
  SoulprintNotReceivedError,
  type SoulHistoryItem,
  type SoulHistoryType,
  type SoulprintNetworkInterface,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { soulHistoryStatusTone, soulHistoryIsRunning } from './status';
import { IssueTokenModal } from './IssueTokenModal';
import { CovenAssignModal } from './CovenAssignModal';
import styles from '../common.module.css';

const HISTORY_LIMIT = 50;
const HISTORY_TYPES: readonly SoulHistoryType[] = ['scenario', 'errand'];

type Tab = 'overview' | 'soulprint' | 'history';

// Skew между collected_at (Soul-side) и received_at (Keeper-side). По ADR-018
// — warn если разница > 10 минут (рассинхрон NTP или долгий path до Keeper-а).
const SKEW_WARN_MS = 10 * 60 * 1000;

function skewWarning(collectedAt?: string, receivedAt?: string): string | null {
  if (!collectedAt || !receivedAt) return null;
  const a = new Date(collectedAt).getTime();
  const b = new Date(receivedAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const diff = Math.abs(b - a);
  if (diff <= SKEW_WARN_MS) return null;
  return i18n.t('souls:skewWarning', { minutes: Math.floor(diff / 60000) });
}

export function SoulDetail() {
  const { t } = useTranslation();
  const { sid = '' } = useParams<{ sid: string }>();
  const [tab, setTab] = useState<Tab>('overview');
  const [tokenOpen, setTokenOpen] = useState(false);
  const [covenOpen, setCovenOpen] = useState(false);

  const soulQ = useQuery({
    queryKey: ['soul', sid],
    queryFn: () => keeperApi.souls.get(sid),
    enabled: Boolean(sid),
  });

  const soulprintQ = useQuery({
    queryKey: ['soulprint', sid],
    queryFn: () => keeperApi.souls.getSoulprint(sid),
    enabled: Boolean(sid) && tab === 'soulprint',
    retry: false,
  });

  if (soulQ.isLoading) return <div className={styles.loading}>{t('loading')}</div>;
  if (soulQ.error) {
    return (
      <div className={styles.errorBox}>
        {soulQ.error instanceof ApiError
          ? t('errors:generic', { status: soulQ.error.status, detail: soulQ.error.message })
          : String(soulQ.error)}
      </div>
    );
  }

  const row = soulQ.data;
  if (!row) {
    return (
      <div className={styles.empty}>
        {t('souls:soulNotFound', { sid })}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.crumbs}>
          <Link to="/souls">souls</Link> / <span>{row.sid}</span>
        </div>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>{row.sid}</h1>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
              <Dot kind={soulDot(row.status)} />
              <Badge tone={soulTone(row.status)}>{row.status}</Badge>
              <Badge tone="muted">{row.transport}</Badge>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {row.transport === 'agent' ? (
              <Button type="button" variant="secondary" onClick={() => setTokenOpen(true)}>
                <Key size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                {t('souls:issueToken')}
              </Button>
            ) : null}
            <Link to={`/errands/new?sid=${encodeURIComponent(row.sid)}`}>
              <Button type="button" variant="secondary">
                <Terminal size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                {t('souls:runErrand')}
              </Button>
            </Link>
            <Button type="button" variant="secondary" onClick={() => setCovenOpen(true)}>
              <Shield size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              {t('souls:covenAssignment')}
            </Button>
          </div>
        </div>
      </div>

      <IssueTokenModal open={tokenOpen} sid={row.sid} onClose={() => setTokenOpen(false)} />
      <CovenAssignModal
        open={covenOpen}
        onClose={() => setCovenOpen(false)}
        variant={{ kind: 'single', sid: row.sid, currentCovens: row.covens ?? [] }}
      />

      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'overview'}
          className={`${styles.tab} ${tab === 'overview' ? styles.tabActive : ''}`}
          onClick={() => setTab('overview')}
        >
          Overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'soulprint'}
          className={`${styles.tab} ${tab === 'soulprint' ? styles.tabActive : ''}`}
          onClick={() => setTab('soulprint')}
        >
          Soulprint
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          className={`${styles.tab} ${tab === 'history' ? styles.tabActive : ''}`}
          onClick={() => setTab('history')}
        >
          History
        </button>
      </div>

      {tab === 'overview' ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Overview</h2>
          <div className={styles.meta}>
            <span className={styles.metaKey}>SID</span>
            <span className={styles.metaVal}>{row.sid}</span>
            <span className={styles.metaKey}>Status</span>
            <span className={styles.metaVal}>{row.status}</span>
            <span className={styles.metaKey}>Transport</span>
            <span className={styles.metaVal}>{row.transport}</span>
            <span className={styles.metaKey}>Covens</span>
            <span className={styles.metaVal}>{row.covens?.join(', ') || '—'}</span>
            <span className={styles.metaKey}>Registered</span>
            <span className={styles.metaVal}>{row.registered_at}</span>
            <span className={styles.metaKey}>Last seen</span>
            <span className={styles.metaVal}>{row.last_seen_at ?? '—'}</span>
            <span className={styles.metaKey}>Last seen by KID</span>
            <span className={styles.metaVal}>{row.last_seen_by_kid ?? '—'}</span>
          </div>
          {row.transport === 'ssh' ? (
            <div
              style={{
                marginTop: 12,
                padding: 'var(--s-3) var(--s-4)',
                background: 'var(--surface)',
                border: '1px dashed var(--border)',
                borderRadius: 'var(--radius)',
                fontSize: 12.5,
                color: 'var(--text-muted)',
              }}
            >
              {t('souls:sshTargetTbdPrefix')}<code className="mono">/v1/souls/{'{sid}'}/ssh-target</code>{t('souls:sshTargetTbdSuffix')}
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'soulprint' ? <SoulprintTab query={soulprintQ} /> : null}

      {tab === 'history' ? <SoulHistoryTab sid={row.sid} /> : null}
    </div>
  );
}

// Per-host timeline (scenario apply_runs + ad-hoc errands), merge started_at DESC.
// Фильтр по источнику (chip scenario/errand) + offset/limit-пейджинг. Polling 5s,
// пока в текущей странице есть нетерминальная запись (running/pending).
function SoulHistoryTab({ sid }: { sid: string }) {
  const { t } = useTranslation();
  const [types, setTypes] = useState<Set<SoulHistoryType>>(new Set());
  const [offset, setOffset] = useState(0);

  const typeFilter = types.size > 0 ? [...types] : undefined;

  const q = useQuery({
    queryKey: ['soul-history', sid, typeFilter, offset],
    queryFn: () =>
      keeperApi.souls.history(sid, { type: typeFilter, offset, limit: HISTORY_LIMIT }),
    enabled: Boolean(sid),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.items.some((it) => soulHistoryIsRunning(it.status)) ? 5000 : false,
  });

  function toggleType(tp: SoulHistoryType) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(tp)) next.delete(tp);
      else next.add(tp);
      return next;
    });
    setOffset(0);
  }

  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const unavailable =
    q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 501);

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>History</h2>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
        {HISTORY_TYPES.map((tp) => {
          const active = types.has(tp);
          return (
            <button
              key={tp}
              type="button"
              data-testid={`history-filter-${tp}`}
              onClick={() => toggleType(tp)}
              aria-pressed={active}
              style={historyChipStyle(active)}
            >
              {tp}
            </button>
          );
        })}
      </div>

      {q.isLoading ? <div className={styles.loading}>{t('loading')}</div> : null}

      {unavailable ? (
        <div className={styles.empty}>
          {t('souls:historyUnavailablePrefix')}
          <code className="mono">GET /v1/souls/{'{sid}'}/history</code>
          {t('souls:historyUnavailableSuffix', { status: (q.error as ApiError).status })}
        </div>
      ) : null}

      {q.error && !unavailable ? (
        <div className={styles.errorBox}>
          {q.error instanceof ApiError
            ? t('errors:generic', { status: q.error.status, detail: q.error.message })
            : String(q.error)}
        </div>
      ) : null}

      {q.data && items.length === 0 ? (
        <div className={styles.empty}>{t('souls:historyEmpty')}</div>
      ) : null}

      {items.length > 0 ? (
        <>
          <table className={styles.table} data-testid="soul-history-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>ID</th>
                <th>Incarnation / Module</th>
                <th>Status</th>
                <th>Started</th>
                <th>Finished</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <SoulHistoryRow key={`${it.type}-${it.id}`} item={it} />
              ))}
            </tbody>
          </table>
          <Pager offset={offset} limit={HISTORY_LIMIT} total={total} shown={items.length} onChange={setOffset} />
        </>
      ) : null}
    </section>
  );
}

// Ссылка по записи timeline:
//   voyage_id присутствует → /voyages/:voyage_id (приоритет, для обоих типов).
//   scenario без voyage_id → /incarnations/:incarnation (standalone apply_run).
//   errand без voyage_id → не кликабельно (standalone errand, роут /errands/:id удалён).
function historyLink(item: SoulHistoryItem): string | null {
  if (item.voyage_id) return `/voyages/${encodeURIComponent(item.voyage_id)}`;
  if (item.type === 'scenario') {
    if (item.incarnation) return `/incarnations/${encodeURIComponent(item.incarnation)}`;
    return null;
  }
  // Standalone errand без voyage_id — не кликабельно.
  return null;
}

function SoulHistoryRow({ item }: { item: SoulHistoryItem }) {
  const to = historyLink(item);
  const idLabel = item.id ?? '—';
  // Вторая колонка: scenario → incarnation/scenario, errand → fully-qualified module.
  const context =
    item.type === 'scenario'
      ? [item.incarnation, item.scenario].filter(Boolean).join(' / ') || '—'
      : (item.module ?? '—');

  return (
    <tr>
      <td>
        <Badge tone={item.type === 'scenario' ? 'info' : 'muted'}>{item.type}</Badge>
      </td>
      <td>
        {to ? (
          <Link to={to} title={idLabel}>
            {idLabel}
          </Link>
        ) : (
          <span className="mono" title={idLabel}>
            {idLabel}
          </span>
        )}
      </td>
      <td className="mono" style={{ fontSize: 12 }}>
        {context}
      </td>
      <td>
        <Badge tone={soulHistoryStatusTone(item.status)}>{item.status}</Badge>
      </td>
      <td className="mono" style={{ fontSize: 12 }} title={item.started_at}>
        {item.started_at}
      </td>
      <td className="mono" style={{ fontSize: 12 }} title={item.finished_at ?? ''}>
        {item.finished_at ?? '—'}
      </td>
    </tr>
  );
}

function historyChipStyle(active: boolean) {
  return {
    padding: '4px 10px',
    fontSize: 12,
    fontFamily: 'var(--font-mono)',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active
      ? 'color-mix(in srgb, var(--accent) 14%, var(--surface))'
      : 'var(--surface)',
    color: active ? 'var(--text)' : 'var(--text-muted)',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
  } as const;
}

interface SoulprintTabProps {
  query: ReturnType<typeof useQuery<Awaited<ReturnType<typeof keeperApi.souls.getSoulprint>>>>;
}

function SoulprintTab({ query }: SoulprintTabProps) {
  const { t } = useTranslation();
  if (query.isLoading) {
    return <div className={styles.loading}>{t('souls:loadingSoulprint')}</div>;
  }
  if (query.error instanceof SoulprintNotReceivedError) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Soulprint</h2>
        <div className={styles.empty}>
          {t('souls:soulprintNotReceived')} <code className="mono">transport: ssh</code> {t('souls:soulprintNotReceivedSsh')}
        </div>
      </section>
    );
  }
  if (query.error) {
    return (
      <div className={styles.errorBox}>
        {query.error instanceof ApiError
          ? t('errors:generic', { status: query.error.status, detail: query.error.message })
          : String(query.error)}
      </div>
    );
  }
  const data = query.data;
  if (!data) return null;

  const facts = data.typed_facts;
  const skew = skewWarning(data.collected_at, data.received_at);

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Soulprint</h2>

      <div className={styles.meta}>
        <span className={styles.metaKey}>collected_at</span>
        <span className={styles.metaVal}>{data.collected_at ?? '—'}</span>
        <span className={styles.metaKey}>received_at</span>
        <span className={styles.metaVal}>{data.received_at ?? '—'}</span>
        <span className={styles.metaKey}>hostname</span>
        <span className={styles.metaVal}>{facts.hostname ?? '—'}</span>
      </div>
      {skew ? (
        <div
          style={{
            padding: 'var(--s-3) var(--s-4)',
            background: 'color-mix(in srgb, var(--warning) 8%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--warning) 30%, var(--border))',
            borderRadius: 'var(--radius)',
            color: 'var(--warning)',
            fontSize: 12.5,
          }}
        >
          {skew}
        </div>
      ) : null}

      <SoulprintOsBlock os={facts.os} />
      <SoulprintKernelBlock kernel={facts.kernel} />
      <SoulprintCpuBlock cpu={facts.cpu} />
      <SoulprintMemoryBlock memory={facts.memory} />
      <SoulprintNetworkBlock network={facts.network} />
    </section>
  );
}

function SoulprintOsBlock({ os }: { os?: NonNullable<Awaited<ReturnType<typeof keeperApi.souls.getSoulprint>>['typed_facts']['os']> | undefined }) {
  if (!os) return null;
  return (
    <div>
      <h3 style={{ fontSize: 13, margin: '8px 0', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>os</h3>
      <div className={styles.meta}>
        <span className={styles.metaKey}>family</span><span className={styles.metaVal}>{os.family ?? '—'}</span>
        <span className={styles.metaKey}>distro</span><span className={styles.metaVal}>{os.distro ?? '—'}</span>
        <span className={styles.metaKey}>version</span><span className={styles.metaVal}>{os.version ?? '—'}</span>
        <span className={styles.metaKey}>codename</span><span className={styles.metaVal}>{os.codename ?? '—'}</span>
        <span className={styles.metaKey}>arch</span><span className={styles.metaVal}>{os.arch ?? '—'}</span>
        <span className={styles.metaKey}>pkg_mgr</span><span className={styles.metaVal}>{os.pkg_mgr ?? '—'}</span>
        <span className={styles.metaKey}>init_system</span><span className={styles.metaVal}>{os.init_system ?? '—'}</span>
      </div>
    </div>
  );
}

function SoulprintKernelBlock({ kernel }: { kernel?: NonNullable<Awaited<ReturnType<typeof keeperApi.souls.getSoulprint>>['typed_facts']['kernel']> | undefined }) {
  if (!kernel) return null;
  return (
    <div>
      <h3 style={{ fontSize: 13, margin: '8px 0', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>kernel</h3>
      <div className={styles.meta}>
        <span className={styles.metaKey}>version</span><span className={styles.metaVal}>{kernel.version ?? '—'}</span>
        <span className={styles.metaKey}>release</span><span className={styles.metaVal}>{kernel.release ?? '—'}</span>
      </div>
    </div>
  );
}

function SoulprintCpuBlock({ cpu }: { cpu?: NonNullable<Awaited<ReturnType<typeof keeperApi.souls.getSoulprint>>['typed_facts']['cpu']> | undefined }) {
  if (!cpu) return null;
  return (
    <div>
      <h3 style={{ fontSize: 13, margin: '8px 0', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>cpu</h3>
      <div className={styles.meta}>
        <span className={styles.metaKey}>count</span><span className={styles.metaVal}>{cpu.count ?? '—'}</span>
        <span className={styles.metaKey}>model</span><span className={styles.metaVal}>{cpu.model ?? '—'}</span>
        <span className={styles.metaKey}>vendor</span><span className={styles.metaVal}>{cpu.vendor ?? '—'}</span>
      </div>
    </div>
  );
}

function SoulprintMemoryBlock({ memory }: { memory?: NonNullable<Awaited<ReturnType<typeof keeperApi.souls.getSoulprint>>['typed_facts']['memory']> | undefined }) {
  if (!memory) return null;
  return (
    <div>
      <h3 style={{ fontSize: 13, margin: '8px 0', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>memory (MB)</h3>
      <div className={styles.meta}>
        <span className={styles.metaKey}>total_mb</span><span className={styles.metaVal}>{memory.total_mb ?? '—'}</span>
        <span className={styles.metaKey}>available_mb</span><span className={styles.metaVal}>{memory.available_mb ?? '—'}</span>
        <span className={styles.metaKey}>swap_mb</span><span className={styles.metaVal}>{memory.swap_mb ?? '—'}</span>
      </div>
    </div>
  );
}

function SoulprintNetworkBlock({ network }: { network?: NonNullable<Awaited<ReturnType<typeof keeperApi.souls.getSoulprint>>['typed_facts']['network']> | undefined }) {
  if (!network) return null;
  const ifaces: SoulprintNetworkInterface[] = network.interfaces ?? [];
  return (
    <div>
      <h3 style={{ fontSize: 13, margin: '8px 0', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>network</h3>
      <div className={styles.meta}>
        <span className={styles.metaKey}>primary_ip</span><span className={styles.metaVal}>{network.primary_ip ?? '—'}</span>
        <span className={styles.metaKey}>fqdn</span><span className={styles.metaVal}>{network.fqdn ?? '—'}</span>
      </div>
      {ifaces.length > 0 ? (
        <table className={styles.table} style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>IPv4</th>
              <th>IPv6</th>
              <th>MAC</th>
              <th>MTU</th>
            </tr>
          </thead>
          <tbody>
            {ifaces.map((iface, i) => (
              <tr key={`${iface.name ?? 'iface'}-${i}`}>
                <td className="mono">{iface.name ?? '—'}</td>
                <td className="mono">{iface.ipv4?.join(', ') || '—'}</td>
                <td className="mono">{iface.ipv6?.join(', ') || '—'}</td>
                <td className="mono">{iface.mac ?? '—'}</td>
                <td className="mono">{iface.mtu ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
