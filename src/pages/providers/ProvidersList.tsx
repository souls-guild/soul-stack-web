import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud, Plus } from 'lucide-react';
import { keeperApi, type Provider } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button, Modal } from '../../components/primitives';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { ProviderCreateModal } from './ProviderCreateModal';
import { prettyProviderError } from './errors';
import styles from '../common.module.css';

function relDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ProvidersList() {
  const { t } = useTranslation(['providers', 'common', 'errors']);
  const qc = useQueryClient();
  const { hasPermission } = useMyPermissions();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null);

  const q = useQuery({
    queryKey: ['providers.list'],
    queryFn: () => keeperApi.providers.list({ limit: 200 }),
  });

  const deleteMu = useMutation({
    mutationFn: (name: string) => keeperApi.providers.delete(name),
    onSuccess: () => {
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['providers.list'] });
    },
  });

  const canCreate = hasPermission('provider.create');
  const canDelete = hasPermission('provider.delete');
  const items = q.data?.items ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Cloud size={22} /> Providers
          </h1>
          <div className={styles.crumbs}>{t('providers:crumbs')}</div>
        </div>
        <Button
          variant="primary"
          type="button"
          onClick={() => setCreateOpen(true)}
          disabled={!canCreate}
          data-testid="provider-create-btn"
          title={!canCreate ? 'provider.create' : undefined}
        >
          <Plus size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
          {t('providers:createBtn')}
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
        <div className={styles.empty}>{t('providers:empty')}</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('providers:colName')}</th>
              <th>{t('providers:colType')}</th>
              <th>{t('providers:colRegion')}</th>
              <th>{t('providers:colCredentials')}</th>
              <th>{t('providers:colCreated')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.name} data-testid={`provider-row-${p.name}`}>
                <td>{p.name}</td>
                <td>
                  <Badge tone="muted">{p.type}</Badge>
                </td>
                <td style={{ fontSize: 12 }}>{p.region}</td>
                <td
                  className="mono"
                  style={{ fontSize: 12, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={p.credentials_ref}
                >
                  {p.credentials_ref}
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{relDate(p.created_at)}</td>
                <td>
                  <Button
                    variant="ghost"
                    type="button"
                    data-testid={`provider-delete-btn-${p.name}`}
                    disabled={!canDelete}
                    title={!canDelete ? 'provider.delete' : undefined}
                    onClick={() => setDeleteTarget(p)}
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

      <ProviderCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />

      <Modal open={deleteTarget !== null} title={t('providers:deleteTitle')} onClose={() => setDeleteTarget(null)}>
        <p style={{ margin: 0, fontSize: 13 }}>{t('providers:deleteConfirm', { name: deleteTarget?.name ?? '' })}</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <Button variant="ghost" type="button" onClick={() => setDeleteTarget(null)} disabled={deleteMu.isPending}>
            {t('common:cancel')}
          </Button>
          <Button
            variant="danger"
            type="button"
            disabled={deleteMu.isPending}
            data-testid="provider-delete-confirm-btn"
            onClick={() => deleteTarget && deleteMu.mutate(deleteTarget.name)}
          >
            {t('common:delete')}
          </Button>
        </div>
        {deleteMu.isError ? (
          <div role="alert" className={styles.errorBox} style={{ marginTop: 8 }}>
            {prettyProviderError(deleteMu.error)}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
