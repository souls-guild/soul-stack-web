import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button } from '../../components/primitives';
import { JsonViewer } from '../../components/JsonViewer';
import styles from '../common.module.css';

export function VigilDetail() {
  const { t } = useTranslation();
  const { name = '' } = useParams<{ name: string }>();
  const qc = useQueryClient();
  const nav = useNavigate();

  const detail = useQuery({
    queryKey: ['vigil', name],
    queryFn: () => keeperApi.vigils.get(name),
    enabled: Boolean(name),
  });

  const deleteMut = useMutation({
    mutationFn: () => keeperApi.vigils.delete(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vigils.list'] });
      nav('/vigils');
    },
  });

  if (detail.isLoading) return <div className={styles.loading}>{t('loading')}</div>;
  if (detail.error) {
    return (
      <div className={styles.errorBox}>
        {detail.error instanceof ApiError
          ? t('errors:generic', { status: detail.error.status, detail: detail.error.message })
          : String(detail.error)}
      </div>
    );
  }
  const v = detail.data;
  if (!v) return <div className={styles.empty}>{t('pages:vigilNotFound')}</div>;

  function handleDelete() {
    if (!window.confirm(t('pages:deleteVigilConfirm', { name }))) return;
    deleteMut.mutate();
  }

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.crumbs}>
          <Link to="/vigils">vigils</Link> / <span>{v.name}</span>
        </div>
        <div className={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Eye size={20} aria-hidden="true" />
            <div>
              <h1 className={styles.title}>{v.name}</h1>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
                <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>{v.check}</span>
                {v.enabled ? <Badge tone="ok">enabled</Badge> : <Badge tone="muted">disabled</Badge>}
                {v.created_by_aid ? (
                  <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    by {v.created_by_aid}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <Button variant="ghost" onClick={handleDelete} disabled={deleteMut.isPending}>
            {deleteMut.isPending ? t('deleting') : t('delete')}
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
        <span className={styles.metaKey}>Beacon kind</span>
        <span className={styles.metaVal}>{v.check}</span>
        <span className={styles.metaKey}>Interval</span>
        <span className={styles.metaVal}>{v.interval}</span>
        <span className={styles.metaKey}>Subject</span>
        <span className={styles.metaVal}>
          {v.sid
            ? `sid: ${v.sid}`
            : v.coven && v.coven.length > 0
              ? `coven: ${v.coven.join(', ')}`
              : '— (весь флот)'}
        </span>
        <span className={styles.metaKey}>Enabled</span>
        <span className={styles.metaVal}>{String(v.enabled)}</span>
        <span className={styles.metaKey}>Created by</span>
        <span className={styles.metaVal}>{v.created_by_aid ?? '—'}</span>
        <span className={styles.metaKey}>Created at</span>
        <span className={styles.metaVal}>{v.created_at}</span>
        <span className={styles.metaKey}>Updated at</span>
        <span className={styles.metaVal}>{v.updated_at}</span>
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Params</h2>
        <JsonViewer value={v.params} emptyLabel="params не заданы" />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Portent history</h2>
        <div className={styles.empty}>
          TBD — endpoint <code className="mono">GET /v1/portents?vigil=…</code> ещё не выставлен в openapi.
        </div>
      </section>
    </div>
  );
}
