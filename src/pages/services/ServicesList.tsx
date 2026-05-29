import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { keeperApi, type ServiceView } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Button } from '../../components/primitives';
import { RegisterServiceModal } from './RegisterServiceModal';
import styles from '../common.module.css';

export function ServicesList() {
  const { t } = useTranslation();
  const [nameFilter, setNameFilter] = useState('');
  const [refFilter, setRefFilter] = useState('');
  const [registerOpen, setRegisterOpen] = useState(false);

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
          <div className={styles.crumbs}>{t('admin:svcCrumbs')}</div>
        </div>
        <Button type="button" variant="primary" onClick={() => setRegisterOpen(true)}>
          {t('registerService')}
        </Button>
      </div>

      <div className={styles.filters}>
        <label>
          <div className={styles.metaKey}>{t('admin:svcNameContains')}</div>
          <input
            type="text"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            placeholder={t('admin:svcNamePlaceholder')}
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
          <div className={styles.metaKey}>{t('admin:svcRefEquals')}</div>
          <input
            type="text"
            value={refFilter}
            onChange={(e) => setRefFilter(e.target.value)}
            placeholder={t('admin:svcRefPlaceholder')}
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

      {q.isLoading ? <div className={styles.loading}>{t('admin:svcLoading')}</div> : null}
      {q.error ? (
        <div className={styles.errorBox}>
          {q.error instanceof ApiError
            ? t('errors:generic', { status: q.error.status, detail: q.error.message })
            : String(q.error)}
        </div>
      ) : null}

      {q.data && filtered.length === 0 ? (
        <div className={styles.empty}>
          {t('admin:svcEmpty')}{' '}
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

      <RegisterServiceModal open={registerOpen} onClose={() => setRegisterOpen(false)} />
    </div>
  );
}
