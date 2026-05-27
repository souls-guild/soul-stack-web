import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Dot } from '../../components/primitives';
import { incarnationDot, incarnationTone } from '../../components/status';
import styles from '../common.module.css';

type Tab = 'overview' | 'incarnations';

export function ServiceDetail() {
  const { name = '' } = useParams<{ name: string }>();
  const [tab, setTab] = useState<Tab>('overview');

  const detail = useQuery({
    queryKey: ['service', name],
    queryFn: () => keeperApi.services.get(name),
    enabled: Boolean(name),
  });

  const incs = useQuery({
    queryKey: ['service.incarnations', name],
    queryFn: () => keeperApi.incarnations.list({ service: name, limit: 200 }),
    enabled: Boolean(name) && tab === 'incarnations',
  });

  if (detail.isLoading) return <div className={styles.loading}>Загружаем…</div>;
  if (detail.error) {
    return (
      <div className={styles.errorBox}>
        {detail.error instanceof ApiError
          ? `Ошибка ${detail.error.status}: ${detail.error.message}`
          : String(detail.error)}
      </div>
    );
  }
  const row = detail.data;
  if (!row) return <div className={styles.empty}>Service не найден.</div>;

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.crumbs}>
          <Link to="/services">services</Link> / <span>{row.name}</span>
        </div>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>{row.name}</h1>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
              <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {row.git}@{row.ref}
              </span>
              {row.refresh ? <Badge tone="info">refresh: {row.refresh}</Badge> : null}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.meta}>
        <span className={styles.metaKey}>Git</span>
        <span className={styles.metaVal}>{row.git}</span>
        <span className={styles.metaKey}>Ref</span>
        <span className={styles.metaVal}>{row.ref}</span>
        <span className={styles.metaKey}>Refresh</span>
        <span className={styles.metaVal}>{row.refresh ?? '—'}</span>
        <span className={styles.metaKey}>Created by</span>
        <span className={styles.metaVal}>{row.created_by_aid ?? '—'}</span>
        <span className={styles.metaKey}>Created at</span>
        <span className={styles.metaVal}>{row.created_at}</span>
        <span className={styles.metaKey}>Updated by</span>
        <span className={styles.metaVal}>{row.updated_by_aid ?? '—'}</span>
        <span className={styles.metaKey}>Updated at</span>
        <span className={styles.metaVal}>{row.updated_at}</span>
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
          aria-selected={tab === 'incarnations'}
          className={`${styles.tab} ${tab === 'incarnations' ? styles.tabActive : ''}`}
          onClick={() => setTab('incarnations')}
        >
          Incarnations
        </button>
      </div>

      {tab === 'overview' ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Service</h2>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Scenarios этого сервиса доступны через git-репо <span className="mono">{row.git}</span> на ref
            <span className="mono"> {row.ref}</span> (каталог <span className="mono">scenario/</span>).
            REST-каталог scenario пока не выставлен; запускать сценарии — через{' '}
            <code className="mono">POST /v1/incarnations</code> и{' '}
            <code className="mono">POST /v1/incarnations/&#123;name&#125;/scenarios/&#123;scenario&#125;</code>.
          </div>
        </section>
      ) : null}

      {tab === 'incarnations' ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Incarnation-ы сервиса</h2>
          {incs.isLoading ? <div className={styles.loading}>Загружаем…</div> : null}
          {incs.error ? (
            <div className={styles.errorBox}>
              {incs.error instanceof ApiError
                ? `Ошибка ${incs.error.status}: ${incs.error.message}`
                : String(incs.error)}
            </div>
          ) : null}
          {incs.data && incs.data.items.length === 0 ? (
            <div className={styles.empty}>
              Инкарнаций этого сервиса пока нет. Создаётся через scenario{' '}
              <code className="mono">create</code>.
            </div>
          ) : null}
          {incs.data && incs.data.items.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Service ref</th>
                  <th>Status</th>
                  <th>Covens</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {incs.data.items.map((inc) => (
                  <tr key={inc.name}>
                    <td>
                      <Link to={`/incarnations/${encodeURIComponent(inc.name)}`}>{inc.name}</Link>
                    </td>
                    <td className="mono">{inc.service_version}</td>
                    <td>
                      <span className={styles.statusCell}>
                        <Dot kind={incarnationDot(inc.status)} title={inc.status} />
                        <Badge tone={incarnationTone(inc.status)}>{inc.status}</Badge>
                      </span>
                    </td>
                    <td className="mono">{inc.covens.join(', ') || '—'}</td>
                    <td className="mono">{inc.updated_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
