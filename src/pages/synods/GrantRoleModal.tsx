import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { prettySynodError } from './errors';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  synodName: string;
  /** Уже привязанные роли (чтобы отфильтровать в селекте). */
  currentRoles: string[];
  onClose: () => void;
}

export function GrantRoleModal({ open, synodName, currentRoles, onClose }: Props) {
  const { t } = useTranslation(['synods', 'common']);
  const qc = useQueryClient();
  const [roleName, setRoleName] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  // Список всех ролей кластера — для селектора.
  const rolesQ = useQuery({
    queryKey: ['rbac.roles'],
    queryFn: () => keeperApi.roles.list(),
    enabled: open,
    staleTime: 30_000,
  });

  const availableRoles = (rolesQ.data?.items ?? []).filter(
    (r) => !currentRoles.includes(r.name),
  );

  const mu = useMutation({
    mutationFn: () => keeperApi.synods.roles.grant(synodName, roleName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['synods'] });
      setRoleName('');
      setServerError(null);
      onClose();
    },
    onError: (err) => setServerError(prettySynodError(err)),
  });

  function close() {
    if (mu.isPending) return;
    setRoleName('');
    setServerError(null);
    onClose();
  }

  const canSubmit = roleName.length > 0 && !mu.isPending;

  return (
    <Modal
      open={open}
      title={t('synods:grantRoleTitle', { name: synodName })}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            {t('common:cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canSubmit}
            onClick={() => { setServerError(null); mu.mutate(); }}
            data-testid="grant-role-submit"
          >
            {mu.isPending ? t('common:adding') : t('common:add')}
          </Button>
        </>
      }
    >
      <form noValidate onSubmit={(e) => { e.preventDefault(); if (canSubmit) mu.mutate(); }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13 }}>{t('synods:grantRoleLabel')}</span>
          <select
            value={roleName}
            onChange={(e) => setRoleName(e.target.value)}
            aria-label={t('synods:grantRoleLabel')}
            data-testid="grant-role-select"
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              fontSize: 13,
              fontFamily: 'var(--font-mono)',
            }}
          >
            <option value="">—</option>
            {availableRoles.map((r) => (
              <option key={r.name} value={r.name}>{r.name}</option>
            ))}
          </select>
        </label>
        {serverError ? (
          <div className={styles.errorBox} style={{ marginTop: 12 }} role="alert">
            {serverError}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
