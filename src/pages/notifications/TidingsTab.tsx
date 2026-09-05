import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { keeperApi, type Tiding } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button, Modal } from '../../components/primitives';
import { EntityIdCell } from '../../components/EntityIdCell';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { TidingModal } from './TidingModal';
import styles from '../common.module.css';

// Tiding — a persistent subscription rule. Ephemeral rules (voyage-bound)
// are not shown in this tab: backend hides them by default.

function relDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function filterSummary(t: (k: string) => string, item: Tiding): string {
  const parts: string[] = [];
  if (item.only_failures) parts.push(t('notifications:onlyFailures'));
  if (item.only_changes) parts.push(t('notifications:onlyChanges'));
  return parts.length > 0 ? parts.join(', ') : t('notifications:noFilters');
}

export function TidingsTab() {
  const { t } = useTranslation('notifications');
  const qc = useQueryClient();
  const { hasPermission } = useMyPermissions();
  const [searchParams] = useSearchParams();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Tiding | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Tiding | null>(null);

  // If the URL has ?cadence=<name> — open the create form with a preset value.
  const prefillCadence = searchParams.get('cadence') ?? undefined;
  useEffect(() => {
    if (prefillCadence) {
      setCreateOpen(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = useQuery({
    queryKey: ['tidings.list'],
    queryFn: () => keeperApi.tidings.list({ limit: 200 }),
  });

  const deleteMu = useMutation({
    mutationFn: (name: string) => keeperApi.tidings.delete(name),
    onSuccess: () => {
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['tidings.list'] });
    },
  });

  const canCreate = hasPermission('tiding.create');
  const canUpdate = hasPermission('tiding.update');
  const canDelete = hasPermission('tiding.delete');

  const items = q.data?.items ?? [];

  return (
    <div>
      <div className={styles.header} style={{ marginBottom: 16 }}>
        <div>
          <h2 className={styles.sectionTitle}>{t('tidingTitle')}</h2>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('tidingSubtitle')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button
            variant="primary"
            type="button"
            onClick={() => setCreateOpen(true)}
            disabled={!canCreate}
            data-testid="tiding-create-btn"
            title={!canCreate ? 'tiding.create' : undefined}
          >
            {t('tidingCreateBtn')}
          </Button>
        </div>
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
        <div className={styles.empty}>{t('tidingEmpty')}</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('common:colLabel')}</th>
              <th>{t('tidingColHerald')}</th>
              <th>{t('tidingColEventTypes')}</th>
              <th>{t('tidingColFilters')}</th>
              <th>{t('tidingColEnabled')}</th>
              <th>{t('tidingColUpdated')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <EntityIdCell entity={item} to={`/notifications/tidings/${encodeURIComponent(item.id)}`} />
                </td>
                <td>
                  <Link
                    to={`/notifications/heralds/${encodeURIComponent(item.herald)}`}
                    data-testid={`tiding-herald-link-${item.id}`}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                  >
                    {item.herald}
                  </Link>
                </td>
                <td
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 12, maxWidth: 220 }}
                  title={(item.event_types ?? []).join(', ')}
                >
                  {(item.event_types ?? []).slice(0, 2).join(', ')}
                  {(item.event_types ?? []).length > 2 ? ` +${(item.event_types ?? []).length - 2}` : ''}
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {filterSummary(t, item)}
                </td>
                <td>
                  {item.enabled ? (
                    <Badge tone="ok">{t('tidingEnabled')}</Badge>
                  ) : (
                    <Badge tone="muted">{t('tidingDisabled')}</Badge>
                  )}
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {relDate(item.updated_at)}
                </td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <Button
                    variant="ghost"
                    type="button"
                    data-testid={`tiding-edit-btn-${item.id}`}
                    disabled={!canUpdate}
                    title={!canUpdate ? 'tiding.update' : undefined}
                    onClick={() => setEditing(item)}
                    style={{ fontSize: 12 }}
                  >
                    {t('common:edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    data-testid={`tiding-delete-btn-${item.id}`}
                    disabled={!canDelete}
                    title={!canDelete ? 'tiding.delete' : undefined}
                    onClick={() => setDeleteTarget(item)}
                    style={{ color: 'var(--danger)', fontSize: 12 }}
                  >
                    {t('common:delete')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <TidingModal open={createOpen} onClose={() => setCreateOpen(false)} initialCadence={prefillCadence} />
      <TidingModal open={editing !== null} onClose={() => setEditing(null)} editing={editing ?? undefined} />

      {/* Delete confirm */}
      <Modal
        open={deleteTarget !== null}
        title={t('tidingDeleteTitle')}
        onClose={() => setDeleteTarget(null)}
      >
        <p style={{ margin: 0, fontSize: 13 }}>
          {t('tidingDeleteConfirm', { name: deleteTarget?.id ?? '' })}
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <Button variant="ghost" type="button" onClick={() => setDeleteTarget(null)} disabled={deleteMu.isPending}>
            {t('common:cancel')}
          </Button>
          <Button
            variant="danger"
            type="button"
            disabled={deleteMu.isPending}
            data-testid="tiding-delete-confirm-btn"
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
