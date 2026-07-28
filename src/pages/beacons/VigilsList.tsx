import { useMemo, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { keeperApi, type VigilView } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button, Pager } from '../../components/primitives';
import { KNOWN_BEACONS } from './schemas';
import styles from '../common.module.css';

function shortJson(v: unknown, max = 60): string {
  if (v === undefined || v === null) return '—';
  try {
    const t = JSON.stringify(v);
    return t.length > max ? `${t.slice(0, max)}…` : t;
  } catch {
    return String(v);
  }
}

function subjectCell(v: VigilView): string {
  if (v.sid) return v.sid;
  if (v.coven && v.coven.length > 0) return v.coven.join(', ');
  return '—';
}

export function VigilsList() {
  const { t } = useTranslation();
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [checkFilter, setCheckFilter] = useState('');
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);

  const q = useQuery({
    queryKey: ['vigils.list', { limit, offset }],
    queryFn: () => keeperApi.vigils.list({ limit, offset }),
  });

  const items = useMemo<VigilView[]>(() => q.data?.items ?? [], [q.data]);
  const total = q.data?.total ?? 0;

  const filtered = useMemo<VigilView[]>(() => {
    let xs = items;
    if (enabledOnly) xs = xs.filter((v) => v.enabled);
    if (checkFilter) xs = xs.filter((v) => v.check === checkFilter);
    return xs;
  }, [items, enabledOnly, checkFilter]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Vigils</h1>
          <div className={styles.crumbs}>{t('beacons:vigilsSubtitle')}</div>
        </div>
        <Link to="/vigils/new">
          <Button variant="primary">{t('newVigil')}</Button>
        </Link>
      </div>

      <div className={styles.filters}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>{t('beacons:enabledOnly')}</span>
          <input
            type="checkbox"
            checked={enabledOnly}
            onChange={(e) => setEnabledOnly(e.target.checked)}
            style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
            aria-label="enabled-only"
          />
        </label>
        <label>
          <div className={styles.metaKey}>{t('colBeaconKind')}</div>
          <select
            value={checkFilter}
            onChange={(e) => setCheckFilter(e.target.value)}
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <option value="">{t('beacons:filterAll')}</option>
            {KNOWN_BEACONS.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </label>
        <label>
          <div className={styles.metaKey}>{t('colLimit')}</div>
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

      {q.data && filtered.length === 0 ? (
        <div className={styles.empty}>
          <Trans i18nKey="beacons:vigilsEmpty" components={{ code: <code className="mono" /> }} />
        </div>
      ) : null}

      {filtered.length > 0 ? (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('colName')}</th>
                <th>{t('colBeaconKind')}</th>
                <th>{t('colSubject')}</th>
                <th>{t('colInterval')}</th>
                <th>{t('colParams')}</th>
                <th>{t('colEnabled')}</th>
                <th>{t('colCreated')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.name}>
                  <td>
                    <Link to={`/vigils/${encodeURIComponent(v.name)}`}>{v.name}</Link>
                  </td>
                  <td className="mono">{v.check}</td>
                  <td className="mono">{subjectCell(v)}</td>
                  <td className="mono">{v.interval}</td>
                  <td className="mono" title={JSON.stringify(v.params)}>{shortJson(v.params)}</td>
                  <td>
                    {v.enabled ? <Badge tone="ok">enabled</Badge> : <Badge tone="muted">disabled</Badge>}
                  </td>
                  <td className="mono">{v.created_at}</td>
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
