import { useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button, Pager } from '../../components/primitives';
import styles from '../common.module.css';

function shortCel(s: string | undefined, max = 80): string {
  if (!s) return '—';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function DecreesList() {
  const { t } = useTranslation();
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);

  const q = useQuery({
    queryKey: ['decrees.list', { limit, offset }],
    queryFn: () => keeperApi.decrees.list({ limit, offset }),
  });

  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Decrees</h1>
          <div className={styles.crumbs}>{t('beacons:decreesSubtitle')}</div>
        </div>
        <Link to="/decrees/new">
          <Button variant="primary">{t('newDecree')}</Button>
        </Link>
      </div>

      <div className={styles.filters}>
        <label>
          <div className={styles.metaKey}>Limit</div>
          <input
            type="number"
            min={1}
            max={200}
            value={limit}
            onChange={(e) => { setLimit(Math.max(1, Math.min(200, Number(e.target.value) || 50))); setOffset(0); }}
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              width: 80,
            }}
          />
        </label>
      </div>

      {q.isLoading ? <div className={styles.loading}>{t('loading')}</div> : null}
      {q.error ? (
        <div className={styles.errorBox}>
          {q.error instanceof ApiError ? t('errors:generic', { status: q.error.status, detail: q.error.message }) : String(q.error)}
        </div>
      ) : null}

      {q.data && items.length === 0 ? (
        <div className={styles.empty}>
          <Trans i18nKey="beacons:decreesEmpty" components={{ code: <code className="mono" /> }} />
        </div>
      ) : null}

      {items.length > 0 ? (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>on_beacon</th>
                <th>where (CEL)</th>
                <th>Action</th>
                <th>Incarnation</th>
                <th>Cooldown</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.name}>
                  <td>
                    <Link to={`/decrees/${encodeURIComponent(d.name)}`}>{d.name}</Link>
                  </td>
                  <td className="mono">{d.on_beacon}</td>
                  <td className="mono" title={d.where}>{shortCel(d.where)}</td>
                  <td className="mono">{d.action_scenario}</td>
                  <td className="mono">
                    <Link to={`/incarnations/${encodeURIComponent(d.incarnation_name)}`}>
                      {d.incarnation_name}
                    </Link>
                  </td>
                  <td className="mono">{d.cooldown || '—'}</td>
                  <td>
                    {d.enabled ? <Badge tone="ok">enabled</Badge> : <Badge tone="muted">disabled</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager offset={offset} limit={limit} total={total} shown={items.length} onChange={setOffset} />
        </>
      ) : null}
    </div>
  );
}
