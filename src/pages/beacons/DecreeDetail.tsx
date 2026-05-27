import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Scroll, AlertTriangle } from 'lucide-react';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button } from '../../components/primitives';
import { JsonViewer } from '../../components/JsonViewer';
import styles from '../common.module.css';

export function DecreeDetail() {
  const { name = '' } = useParams<{ name: string }>();
  const qc = useQueryClient();
  const nav = useNavigate();

  const detail = useQuery({
    queryKey: ['decree', name],
    queryFn: () => keeperApi.decrees.get(name),
    enabled: Boolean(name),
  });

  const deleteMut = useMutation({
    mutationFn: () => keeperApi.decrees.delete(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['decrees.list'] });
      nav('/decrees');
    },
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
  const d = detail.data;
  if (!d) return <div className={styles.empty}>Decree не найден.</div>;

  function handleDelete() {
    if (!window.confirm(`Удалить Decree ${name}? Cooldown-state (oracle_fires) каскадно очистится.`)) return;
    deleteMut.mutate();
  }

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.crumbs}>
          <Link to="/decrees">decrees</Link> / <span>{d.name}</span>
        </div>
        <div className={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Scroll size={20} aria-hidden="true" />
            <div>
              <h1 className={styles.title}>{d.name}</h1>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
                <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  on_beacon: {d.on_beacon}
                </span>
                {d.enabled ? <Badge tone="ok">enabled</Badge> : <Badge tone="muted">disabled (default-deny)</Badge>}
                {!d.enabled ? <AlertTriangle size={14} color="var(--text-muted)" aria-hidden="true" /> : null}
              </div>
            </div>
          </div>
          <Button variant="ghost" onClick={handleDelete} disabled={deleteMut.isPending}>
            {deleteMut.isPending ? 'Удаляем…' : 'Delete'}
          </Button>
        </div>
      </div>

      {deleteMut.error ? (
        <div className={styles.errorBox}>
          {deleteMut.error instanceof ApiError
            ? `Ошибка ${deleteMut.error.status}: ${deleteMut.error.message}`
            : String(deleteMut.error)}
        </div>
      ) : null}

      <div className={styles.meta}>
        <span className={styles.metaKey}>on_beacon</span>
        <span className={styles.metaVal}>
          <Link to={`/vigils/${encodeURIComponent(d.on_beacon)}`}>{d.on_beacon}</Link>
        </span>
        <span className={styles.metaKey}>Subject</span>
        <span className={styles.metaVal}>
          {d.sid
            ? `sid: ${d.sid}`
            : d.coven && d.coven.length > 0
              ? `coven: ${d.coven.join(', ')}`
              : '— (любой subject Vigil-а)'}
        </span>
        <span className={styles.metaKey}>Incarnation</span>
        <span className={styles.metaVal}>
          <Link to={`/incarnations/${encodeURIComponent(d.incarnation_name)}`}>
            {d.incarnation_name}
          </Link>
        </span>
        <span className={styles.metaKey}>Action scenario</span>
        <span className={styles.metaVal}>{d.action_scenario}</span>
        <span className={styles.metaKey}>Cooldown</span>
        <span className={styles.metaVal}>{d.cooldown || '—'}</span>
        <span className={styles.metaKey}>Enabled</span>
        <span className={styles.metaVal}>{String(d.enabled)}</span>
        <span className={styles.metaKey}>Created by</span>
        <span className={styles.metaVal}>{d.created_by_aid ?? '—'}</span>
        <span className={styles.metaKey}>Created at</span>
        <span className={styles.metaVal}>{d.created_at}</span>
        <span className={styles.metaKey}>Updated at</span>
        <span className={styles.metaVal}>{d.updated_at}</span>
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>CEL where</h2>
        {d.where ? (
          <pre
            style={{
              margin: 0,
              padding: 12,
              fontFamily: 'var(--font-mono)',
              fontSize: 12.5,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {d.where}
          </pre>
        ) : (
          <div className={styles.empty}>where не задан (срабатывает на любой Portent от Vigil-а)</div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Action input</h2>
        <JsonViewer value={d.action_input} emptyLabel="action_input не задан" />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Recent fires</h2>
        <div className={styles.empty}>
          TBD — endpoint <code className="mono">GET /v1/oracle/fires</code> ещё не выставлен в openapi.
        </div>
      </section>
    </div>
  );
}
