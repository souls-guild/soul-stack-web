import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Puzzle, Plus } from 'lucide-react';
import { keeperApi, type PluginSigilView } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button } from '../../components/primitives';
import styles from '../common.module.css';

// Известные namespace-ы Sigil-реестра (см. /v1/plugins/sigils schema description).
// `mod` = SoulModule + soul_beacon, `cloud` = CloudDriver, `ssh` = SshProvider.
const KNOWN_NAMESPACES = ['mod', 'cloud', 'ssh'] as const;

type StatusFilter = '' | 'active' | 'revoked';

function statusOf(row: PluginSigilView): 'active' | 'revoked' {
  return row.revoked_at ? 'revoked' : 'active';
}

export function PluginsList() {
  const [namespace, setNamespace] = useState<string>('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [search, setSearch] = useState('');

  const q = useQuery({
    queryKey: ['plugins.sigils.list'],
    queryFn: () => keeperApi.plugins.sigils.list(),
  });

  const items = useMemo<PluginSigilView[]>(() => q.data?.items ?? [], [q.data]);

  // Уникальные namespace-ы из ответа + known (на случай если ничего нет, чипы
  // всё равно есть — чтобы было видно, какие бывают).
  const allNamespaces = useMemo<string[]>(() => {
    const set = new Set<string>(KNOWN_NAMESPACES);
    for (const it of items) set.add(it.namespace);
    return [...set].sort();
  }, [items]);

  const filtered = useMemo<PluginSigilView[]>(() => {
    const s = search.trim().toLowerCase();
    return items.filter((it) => {
      if (namespace && it.namespace !== namespace) return false;
      if (status && statusOf(it) !== status) return false;
      if (s && !it.name.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [items, namespace, status, search]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Puzzle size={22} /> Plugins
          </h1>
          <div className={styles.crumbs}>
            Sigil-allow-list плагинов (ADR-026, вариант C — Keeper считает sha256
            сам по локальному кешу host-а)
          </div>
        </div>
        <Link to="/plugins/register" style={{ textDecoration: 'none' }}>
          <Button variant="primary">
            <Plus size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
            Допустить плагин
          </Button>
        </Link>
      </div>

      <div className={styles.filters}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className={styles.metaKey}>Namespace</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setNamespace('')}
              aria-pressed={namespace === ''}
              style={chipStyle(namespace === '')}
            >
              all
            </button>
            {allNamespaces.map((ns) => (
              <button
                key={ns}
                type="button"
                onClick={() => setNamespace(ns)}
                aria-pressed={namespace === ns}
                style={chipStyle(namespace === ns)}
              >
                {ns}
              </button>
            ))}
          </div>
        </div>
        <label>
          <div className={styles.metaKey}>Status</div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
            }}
          >
            <option value="">— все —</option>
            <option value="active">active</option>
            <option value="revoked">revoked</option>
          </select>
        </label>
        <label>
          <div className={styles.metaKey}>Name contains</div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="soul-mod-acme / aws / …"
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              fontFamily: 'var(--font-mono)',
            }}
          />
        </label>
      </div>

      {q.isLoading ? <div className={styles.loading}>Загружаем…</div> : null}
      {q.error ? (
        <div className={styles.errorBox}>
          {q.error instanceof ApiError
            ? `Ошибка ${q.error.status}: ${q.error.message}`
            : String(q.error)}
        </div>
      ) : null}

      {q.data && filtered.length === 0 ? (
        <div className={styles.empty}>
          Sigil-допусков под фильтр не найдено. Допускаются через{' '}
          <code className="mono">keeper.plugin.allow</code>.
        </div>
      ) : null}

      {filtered.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Namespace</th>
              <th>Name</th>
              <th>Ref</th>
              <th>SHA-256</th>
              <th>Status</th>
              <th>Allowed at</th>
              <th>Allowed by</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const st = statusOf(row);
              return (
                <tr key={`${row.namespace}/${row.name}/${row.ref}`}>
                  <td className="mono">
                    <Badge tone="info">{row.namespace}</Badge>
                  </td>
                  <td>
                    <Link
                      to={`/plugins/${encodeURIComponent(row.namespace)}/${encodeURIComponent(row.name)}/${encodeURIComponent(row.ref)}`}
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="mono">{row.ref}</td>
                  <td className="mono" title={row.sha256}>
                    {row.sha256.slice(0, 16)}…
                  </td>
                  <td>
                    {st === 'active' ? (
                      <Badge tone="ok">active</Badge>
                    ) : (
                      <Badge tone="danger">revoked</Badge>
                    )}
                  </td>
                  <td className="mono">{row.allowed_at}</td>
                  <td className="mono">{row.allowed_by_aid}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: 999,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'color-mix(in srgb, var(--accent) 12%, var(--surface))' : 'var(--surface)',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    fontSize: 12,
    fontFamily: 'var(--font-mono)',
    cursor: 'pointer',
  };
}
