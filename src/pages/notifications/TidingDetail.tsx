import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button } from '../../components/primitives';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { TidingModal } from './TidingModal';
import styles from '../common.module.css';

function relDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function TidingDetail() {
  const { t } = useTranslation('notifications');
  const { name = '' } = useParams<{ name: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { hasPermission } = useMyPermissions();
  const [editOpen, setEditOpen] = useState(false);

  const tidingQ = useQuery({
    queryKey: ['tiding.get', name],
    queryFn: () => keeperApi.tidings.get(name),
    enabled: Boolean(name),
  });

  const deleteMu = useMutation({
    mutationFn: () => keeperApi.tidings.delete(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tidings.list'] });
      nav('/notifications?tab=tidings');
    },
  });

  const canUpdate = hasPermission('tiding.update');
  const canDelete = hasPermission('tiding.delete');

  if (tidingQ.isLoading) return <div className={styles.loading}>{t('common:loading')}</div>;
  if (tidingQ.error) {
    return (
      <div className={styles.errorBox}>
        {tidingQ.error instanceof ApiError
          ? t('errors:generic', { status: tidingQ.error.status, detail: tidingQ.error.message })
          : String(tidingQ.error)}
      </div>
    );
  }

  const td = tidingQ.data;
  if (!td) return <div className={styles.empty}>{t('tidingEmpty')}</div>;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <Bell size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
            {td.name}
          </h1>
          <div className={styles.crumbs}>
            <Link to="/notifications">{t('pageTitle')}</Link>
            {' / '}
            <Link to="/notifications?tab=tidings">{t('tidingTitle')}</Link>
            {' / '}
            {td.name}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {td.enabled ? (
            <Badge tone="ok">{t('tidingEnabled')}</Badge>
          ) : (
            <Badge tone="muted">{t('tidingDisabled')}</Badge>
          )}
          <Button
            variant="ghost"
            type="button"
            disabled={!canUpdate}
            onClick={() => setEditOpen(true)}
            title={!canUpdate ? 'tiding.update' : undefined}
          >
            {t('common:edit')}
          </Button>
          <Button
            variant="ghost"
            type="button"
            disabled={!canDelete}
            onClick={() => {
              if (window.confirm(t('tidingDeleteConfirm', { name: td.name }))) {
                deleteMu.mutate();
              }
            }}
            style={{ color: 'var(--danger)' }}
            title={!canDelete ? 'tiding.delete' : undefined}
          >
            {deleteMu.isPending ? '…' : t('common:delete')}
          </Button>
        </div>
      </div>

      {deleteMu.error ? (
        <div role="alert" className={styles.errorBox}>
          {deleteMu.error instanceof ApiError
            ? t('errors:generic', { status: deleteMu.error.status, detail: deleteMu.error.message })
            : String(deleteMu.error)}
        </div>
      ) : null}

      <div className={styles.section}>
        <dl className={styles.meta}>
          <dt className={styles.metaKey}>{t('heraldLinkLabel')}</dt>
          <dd className={styles.metaVal}>
            <Link to={`/notifications/heralds/${encodeURIComponent(td.herald)}`} data-testid="tiding-detail-herald-link">
              {td.herald}
            </Link>
          </dd>

          <dt className={styles.metaKey}>{t('tidingColEventTypes')}</dt>
          <dd className={styles.metaVal} style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            {(td.event_types ?? []).join(', ')}
          </dd>

          <dt className={styles.metaKey}>{t('tidingFieldOnlyFailures')}</dt>
          <dd className={styles.metaVal}>{String(td.only_failures)}</dd>

          <dt className={styles.metaKey}>{t('tidingFieldOnlyChanges')}</dt>
          <dd className={styles.metaVal}>{String(td.only_changes)}</dd>

          {td.incarnation ? (
            <>
              <dt className={styles.metaKey}>{t('tidingFieldIncarnation')}</dt>
              <dd className={styles.metaVal}>
                <Link to={`/incarnations/${encodeURIComponent(td.incarnation)}`}>{td.incarnation}</Link>
              </dd>
            </>
          ) : null}

          {td.cadence ? (
            <>
              <dt className={styles.metaKey}>{t('tidingFieldCadence')}</dt>
              <dd className={styles.metaVal}>
                <Link to={`/cadences/${encodeURIComponent(td.cadence)}`}>{td.cadence}</Link>
              </dd>
            </>
          ) : null}

          {td.task ? (
            <>
              <dt className={styles.metaKey}>{t('tidingFieldTask')}</dt>
              <dd className={styles.metaVal} style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} data-testid="tiding-detail-task">
                {td.task}
              </dd>
            </>
          ) : null}

          <dt className={styles.metaKey}>{t('fieldCreatedAt')}</dt>
          <dd className={styles.metaVal}>{relDate(td.created_at)}</dd>

          <dt className={styles.metaKey}>{t('fieldUpdatedAt')}</dt>
          <dd className={styles.metaVal}>{relDate(td.updated_at)}</dd>

          {td.created_by_aid ? (
            <>
              <dt className={styles.metaKey}>{t('fieldCreatedBy')}</dt>
              <dd className={styles.metaVal}>
                <Link to={`/archons/${encodeURIComponent(td.created_by_aid)}`}>
                  {td.created_by_aid}
                </Link>
              </dd>
            </>
          ) : null}

          {/* annotations */}
          {td.annotations && Object.keys(td.annotations).length > 0 ? (
            <>
              <dt className={styles.metaKey}>{t('tidingFieldAnnotations')}</dt>
              <dd className={styles.metaVal} data-testid="tiding-detail-annotations">
                <pre style={{ margin: 0, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                  {JSON.stringify(td.annotations, null, 2)}
                </pre>
              </dd>
            </>
          ) : null}

          {/* projection */}
          {td.projection && td.projection.length > 0 ? (
            <>
              <dt className={styles.metaKey}>{t('tidingFieldProjection')}</dt>
              <dd className={styles.metaVal} data-testid="tiding-detail-projection">
                {td.projection.join(', ')}
              </dd>
            </>
          ) : null}
        </dl>
      </div>

      <TidingModal open={editOpen} onClose={() => setEditOpen(false)} editing={td} />
    </div>
  );
}
