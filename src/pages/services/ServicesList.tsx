import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { keeperApi, type ServiceView } from '../../api/keeper';
import { ApiError } from '../../api/client';
import styles from '../common.module.css';

export function ServicesList() {
  const [nameFilter, setNameFilter] = useState('');
  const [refFilter, setRefFilter] = useState('');

  const q = useQuery({
    queryKey: ['services.list'],
    queryFn: () => keeperApi.services.list(),
  });

  const filtered = useMemo<ServiceView[]>(() => {
    const items = q.data?.items ?? [];
    const n = nameFilter.trim().toLowerCase();
    const r = refFilter.trim();
    if (!n && !r) return items;
    return items.filter((s) => {
      if (n && !s.name.toLowerCase().includes(n)) return false;
      if (r && s.ref !== r) return false;
      return true;
    });
  }, [q.data, nameFilter, refFilter]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Services</h1>
          <div className={styles.crumbs}>реестр Service-ов (git+ref, ADR-007)</div>
        </div>
      </div>

      <div className={styles.filters}>
        <label>
          <div className={styles.metaKey}>Name contains</div>
          <input
            type="text"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            placeholder="redis / postgres / …"
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              fontFamily: 'var(--font-mono)',
            }}
          />
        </label>
        <label>
          <div className={styles.metaKey}>Ref equals</div>
          <input
            type="text"
            value={refFilter}
            onChange={(e) => setRefFilter(e.target.value)}
            placeholder="v2.0.0 / main"
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
          {q.error instanceof ApiError ? `Ошибка ${q.error.status}: ${q.error.message}` : String(q.error)}
        </div>
      ) : null}

      {q.data && filtered.length === 0 ? (
        <div className={styles.empty}>
          Service-ов под фильтр не найдено. Регистрируются через{' '}
          <code className="mono">keeper.service.register</code>.
        </div>
      ) : null}

      {filtered.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Git</th>
              <th>Ref</th>
              <th>Refresh</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.name}>
                <td>
                  <Link to={`/services/${encodeURIComponent(s.name)}`}>{s.name}</Link>
                </td>
                <td className="mono" style={{ wordBreak: 'break-all' }}>{s.git}</td>
                <td className="mono">{s.ref}</td>
                <td className="mono">{s.refresh ?? '—'}</td>
                <td className="mono">{s.updated_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
