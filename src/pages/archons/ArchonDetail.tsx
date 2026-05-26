import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { keeperApi, type OperatorAuthMethod } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge } from '../../components/primitives';
import { JsonViewer } from '../../components/JsonViewer';
import styles from '../common.module.css';

type Tab = 'info' | 'activity';

function authMethodTone(m: OperatorAuthMethod | string | undefined):
  'ok' | 'warn' | 'info' | 'muted' {
  switch (m) {
    case 'mtls':
      return 'ok';
    case 'combined':
      return 'info';
    case 'jwt':
      return 'warn';
    default:
      return 'muted';
  }
}

export function ArchonDetail() {
  const { aid = '' } = useParams<{ aid: string }>();
  const [tab, setTab] = useState<Tab>('info');

  const q = useQuery({
    queryKey: ['operator', aid],
    queryFn: () => keeperApi.operators.get(aid),
    enabled: Boolean(aid),
  });

  if (q.isLoading) return <div className={styles.loading}>Загружаем…</div>;
  if (q.error) {
    return (
      <div className={styles.errorBox}>
        {q.error instanceof ApiError ? `Ошибка ${q.error.status}: ${q.error.message}` : String(q.error)}
      </div>
    );
  }
  const op = q.data;
  if (!op) return <div className={styles.empty}>Архонт не найден.</div>;

  const revoked = Boolean(op.revoked_at);
  const hasMetadata = op.metadata && Object.keys(op.metadata).length > 0;

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.crumbs}>
          <Link to="/archons">archons</Link> / <span className="mono">{op.aid}</span>
        </div>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>{op.display_name}</h1>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
              <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {op.aid}
              </span>
              <Badge tone={authMethodTone(op.auth_method)}>{op.auth_method}</Badge>
              {op.bootstrap_initial ? <Badge tone="info">bootstrap initial</Badge> : null}
              {revoked ? <Badge tone="danger">revoked</Badge> : <Badge tone="ok">active</Badge>}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'info'}
          className={`${styles.tab} ${tab === 'info' ? styles.tabActive : ''}`}
          onClick={() => setTab('info')}
        >
          Info
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'activity'}
          className={`${styles.tab} ${tab === 'activity' ? styles.tabActive : ''}`}
          onClick={() => setTab('activity')}
        >
          Activity
        </button>
      </div>

      {tab === 'info' ? (
        <>
          <div className={styles.meta}>
            <span className={styles.metaKey}>AID</span>
            <span className={styles.metaVal}>{op.aid}</span>
            <span className={styles.metaKey}>Display name</span>
            <span className={styles.metaVal}>{op.display_name}</span>
            <span className={styles.metaKey}>Auth method</span>
            <span className={styles.metaVal}>{op.auth_method}</span>
            <span className={styles.metaKey}>Created at</span>
            <span className={styles.metaVal}>{op.created_at}</span>
            <span className={styles.metaKey}>Created by</span>
            <span className={styles.metaVal}>{op.created_by_aid ?? '— (bootstrap)'}</span>
            <span className={styles.metaKey}>Revoked at</span>
            <span className={styles.metaVal}>{op.revoked_at ?? '—'}</span>
            <span className={styles.metaKey}>Bootstrap initial</span>
            <span className={styles.metaVal}>{op.bootstrap_initial ? 'true' : 'false'}</span>
          </div>
          <section className={styles.section} aria-label="metadata">
            <h2 className={styles.sectionTitle}>Metadata</h2>
            {hasMetadata ? (
              <JsonViewer value={op.metadata} />
            ) : (
              <div className={styles.empty} style={{ padding: 'var(--s-3)' }}>metadata пустой</div>
            )}
          </section>
        </>
      ) : null}

      {tab === 'activity' ? (
        <section className={styles.section} aria-label="activity">
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            История действий Архонта в audit-журнале. Открывает <code className="mono">/audit</code>
            с предустановленным фильтром <code className="mono">archon_aid={op.aid}</code>.
          </p>
          <div>
            <Link
              to={`/audit?archon_aid=${encodeURIComponent(op.aid)}`}
              style={{
                display: 'inline-block',
                padding: '8px 14px',
                background: 'var(--accent)',
                color: 'var(--accent-on)',
                borderRadius: 'var(--radius)',
                textDecoration: 'none',
                fontSize: 13,
              }}
            >
              Открыть Audit ↗
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
