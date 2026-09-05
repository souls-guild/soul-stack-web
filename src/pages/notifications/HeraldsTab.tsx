import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { keeperApi, type Herald } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button, Modal } from '../../components/primitives';
import { EntityIdCell } from '../../components/EntityIdCell';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { HeraldModal } from './HeraldModal';
import styles from '../common.module.css';

function relDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function HeraldsTab() {
  const { t } = useTranslation('notifications');
  const qc = useQueryClient();
  const { hasPermission } = useMyPermissions();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Herald | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Herald | null>(null);

  const q = useQuery({
    queryKey: ['heralds.list'],
    queryFn: () => keeperApi.heralds.list({ limit: 200 }),
  });

  const deleteMu = useMutation({
    mutationFn: (name: string) => keeperApi.heralds.delete(name),
    onSuccess: () => {
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['heralds.list'] });
    },
  });

  const canCreate = hasPermission('herald.create');
  const canUpdate = hasPermission('herald.update');
  const canDelete = hasPermission('herald.delete');

  const items = q.data?.items ?? [];

  return (
    <div>
      <div className={styles.header} style={{ marginBottom: 16 }}>
        <div>
          <h2 className={styles.sectionTitle}>{t('heraldTitle')}</h2>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('heraldSubtitle')}</div>
        </div>
        <Button
          variant="primary"
          type="button"
          onClick={() => setCreateOpen(true)}
          disabled={!canCreate}
          data-testid="herald-create-btn"
          title={!canCreate ? 'herald.create' : undefined}
        >
          {t('heraldCreateBtn')}
        </Button>
      </div>

      {q.isLoading ? (
        <div className={styles.loading}>{t('common:loading')}</div>
      ) : q.error ? (
        <div className={styles.errorBox}>
          {q.error instanceof ApiError
            ? t('errors:generic', { status: q.error.status, detail: q.error.message })
            : String(q.error)}
        </div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>{t('heraldEmpty')}</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('heraldColName')}</th>
              <th>{t('heraldColType')}</th>
              <th>{t('heraldColUrl')}</th>
              <th>{t('heraldColEnabled')}</th>
              <th>{t('heraldColUpdated')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((h) => {
              const cfg = (h.config ?? {}) as Record<string, unknown>;
              const url = typeof cfg.url === 'string' ? cfg.url : '—';
              return (
                <tr key={h.id}>
                  <td>
                    <EntityIdCell entity={h} to={`/notifications/heralds/${encodeURIComponent(h.id)}`} />
                  </td>
                  <td>
                    <Badge tone="muted">{h.type}</Badge>
                  </td>
                  <td
                    className="mono"
                    style={{ fontSize: 12, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={url}
                  >
                    {url}
                  </td>
                  <td>
                    {h.enabled ? (
                      <Badge tone="ok">{t('heraldEnabled')}</Badge>
                    ) : (
                      <Badge tone="muted">{t('heraldDisabled')}</Badge>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {relDate(h.updated_at)}
                  </td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <Button
                      variant="ghost"
                      type="button"
                      data-testid={`herald-edit-btn-${h.id}`}
                      disabled={!canUpdate}
                      title={!canUpdate ? 'herald.update' : undefined}
                      onClick={() => setEditing(h)}
                      style={{ fontSize: 12 }}
                    >
                      {t('common:edit')}
                    </Button>
                    <Button
                      variant="ghost"
                      type="button"
                      data-testid={`herald-delete-btn-${h.id}`}
                      disabled={!canDelete}
                      title={!canDelete ? 'herald.delete' : undefined}
                      onClick={() => setDeleteTarget(h)}
                      style={{ color: 'var(--danger)', fontSize: 12 }}
                    >
                      {t('common:delete')}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <HeraldModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <HeraldModal open={editing !== null} onClose={() => setEditing(null)} editing={editing ?? undefined} />

      {/* Delete confirm */}
      <Modal
        open={deleteTarget !== null}
        title={t('heraldDeleteTitle')}
        onClose={() => setDeleteTarget(null)}
      >
        <p style={{ margin: 0, fontSize: 13 }}>
          {t('heraldDeleteConfirm', { name: deleteTarget?.id ?? '' })}
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <Button variant="ghost" type="button" onClick={() => setDeleteTarget(null)} disabled={deleteMu.isPending}>
            {t('common:cancel')}
          </Button>
          <Button
            variant="danger"
            type="button"
            disabled={deleteMu.isPending}
            data-testid="herald-delete-confirm-btn"
            onClick={() => deleteTarget && deleteMu.mutate(deleteTarget.id)}
          >
            {t('common:delete')}
          </Button>
        </div>
        {deleteMu.isError ? (
          <div role="alert" className={styles.errorBox} style={{ marginTop: 8 }}>
            {deleteMu.error instanceof ApiError
              ? t('errors:generic', { status: deleteMu.error.status, detail: deleteMu.error.message })
              : String(deleteMu.error)}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
