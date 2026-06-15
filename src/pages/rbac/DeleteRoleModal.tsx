import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from '../../components/primitives';
import { keeperApi, type RoleView } from '../../api/keeper';
import { prettyRbacError } from './errors';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  role: RoleView;
  onClose: () => void;
}

export function DeleteRoleModal({ open, role, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const mu = useMutation({
    mutationFn: () => keeperApi.roles.delete(role.name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rbac.roles'] });
      onClose();
    },
    onError: (err) => setServerError(prettyRbacError(err)),
  });

  function close() {
    if (mu.isPending) return;
    setServerError(null);
    onClose();
  }

  const operatorsCount = (role.operators ?? []).length;

  return (
    <Modal
      open={open}
      title={t('forms:deleteRoleTitle', { name: role.name })}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={mu.isPending || role.builtin}
            onClick={() => { setServerError(null); mu.mutate(); }}
          >
            {mu.isPending ? t('deleting') : t('delete')}
          </Button>
        </>
      }
    >
      <div
        style={{
          padding: 12,
          background: 'color-mix(in srgb, var(--danger) 8%, var(--surface))',
          border: '1px solid color-mix(in srgb, var(--danger) 30%, var(--border))',
          borderRadius: 'var(--radius)',
          fontSize: 13,
          color: 'var(--danger)',
          marginBottom: 12,
        }}
      >
        {t('admin:rbacDeleteWarn')}
      </div>
      {role.builtin ? (
        <div style={{ fontSize: 13, marginBottom: 12 }}>
          {t('admin:rbacDeleteBuiltinWarn')}
        </div>
      ) : null}
      {operatorsCount > 0 ? (
        <div style={{ fontSize: 13, marginBottom: 12 }}>
          <strong>{operatorsCount}</strong>{' '}
          {operatorsCount === 1 ? t('admin:rbacDeleteOperatorLoseOne') : t('admin:rbacDeleteOperatorLoseMany')}{' '}
          {t('admin:rbacDeleteOperatorSuffix')}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {(role.operators ?? []).map((aid) => (
              <code
                key={aid}
                style={{
                  padding: '2px 8px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-pill)',
                  fontSize: 12,
                }}
              >
                {aid}
              </code>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13, marginBottom: 12, color: 'var(--text-muted)' }}>
          {t('admin:rbacDeleteNoOperators')}
        </div>
      )}
      {serverError ? <div className={styles.errorBox} role="alert">{serverError}</div> : null}
    </Modal>
  );
}
