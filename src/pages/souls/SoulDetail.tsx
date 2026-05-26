import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Badge, Dot } from '../../components/primitives';
import { soulDot, soulTone } from '../../components/status';
import {
  keeperApi,
  SoulprintNotReceivedError,
  type SoulprintNetworkInterface,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import styles from '../common.module.css';

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
  return `skew ${Math.floor(diff / 60000)} мин (collected_at vs received_at; > 10 мин — возможен NTP-рассинхрон)`;
}

export function SoulDetail() {
  const { sid = '' } = useParams<{ sid: string }>();
  const [tab, setTab] = useState<Tab>('overview');

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

  if (soulQ.isLoading) return <div className={styles.loading}>Загружаем…</div>;
  if (soulQ.error) {
    return (
      <div className={styles.errorBox}>
        {soulQ.error instanceof ApiError
          ? `Ошибка ${soulQ.error.status}: ${soulQ.error.message}`
          : String(soulQ.error)}
      </div>
    );
  }

  const row = soulQ.data;
  if (!row) {
    return (
      <div className={styles.empty}>
        Soul <code className="mono">{sid}</code> не найдена.
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
        </div>
      </div>

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
        </section>
      ) : null}

      {tab === 'soulprint' ? <SoulprintTab query={soulprintQ} /> : null}

      {tab === 'history' ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>History</h2>
          <div className={styles.empty}>
            TODO: endpoint <code className="mono">GET /v1/souls/{'{sid}'}/history</code> в core ещё не выставлен.
          </div>
        </section>
      ) : null}
    </div>
  );
}

interface SoulprintTabProps {
  query: ReturnType<typeof useQuery<Awaited<ReturnType<typeof keeperApi.souls.getSoulprint>>>>;
}

function SoulprintTab({ query }: SoulprintTabProps) {
  if (query.isLoading) {
    return <div className={styles.loading}>Загружаем soulprint…</div>;
  }
  if (query.error instanceof SoulprintNotReceivedError) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Soulprint</h2>
        <div className={styles.empty}>
          Soulprint ещё не получен от Soul (410). Возможные причины: только что
          онбординг, либо <code className="mono">transport: ssh</code> без агента.
        </div>
      </section>
    );
  }
  if (query.error) {
    return (
      <div className={styles.errorBox}>
        {query.error instanceof ApiError
          ? `Ошибка ${query.error.status}: ${query.error.message}`
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
