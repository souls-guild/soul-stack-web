import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from '../../components/primitives';
import { keeperApi, type RoleView } from '../../api/keeper';
import { prettyRbacError } from './errors';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  aid: string;
  // All roles in the cluster — for the select. A given operator's membership
  // is derived from this via role.operators.includes(aid).
  roles: readonly RoleView[];
  onClose: () => void;
}

// Assign a role to an operator: POST /v1/roles/{name}/operators with {aid}.
// Server returns 204 on success, idempotent. Roles the operator already
// belongs to are hidden (filtered by operators[]).
export function AssignRoleModal({ open, aid, roles, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string>('');
  const [serverError, setServerError] = useState<string | null>(null);

  const candidates = roles.filter((r) => !(r.operators ?? []).includes(aid));

  const mu = useMutation({
    mutationFn: (roleName: string) => keeperApi.roles.grantOperator(roleName, { aid }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rbac.roles'] });
      setSelected('');
      onClose();
    },
    onError: (err) => setServerError(prettyRbacError(err)),
  });

  function close() {
    if (mu.isPending) return;
    setServerError(null);
    setSelected('');
    onClose();
  }

  return (
    <Modal
      open={open}
      title={t('forms:assignRoleTitle', { aid })}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={mu.isPending || !selected}
            onClick={() => { setServerError(null); mu.mutate(selected); }}
          >
            {mu.isPending ? t('assigning') : t('assign')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 'var(--s-4)' }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          {t('admin:rbacAssignProse')}
        </p>
        {candidates.length === 0 ? (
          <div className={styles.empty} style={{ padding: 'var(--s-4)' }}>
            {t('admin:rbacAssignAllRoles')}
          </div>
        ) : (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className={styles.metaKey}>{t('common:colRole')}</span>
            <select
              aria-label={t('common:roleAria')}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              style={{
                padding: '8px 10px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
              }}
            >
              <option value="">{t('admin:rbacAssignSelectPlaceholder')}</option>
              {candidates.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name}{r.builtin ? ` ${t('admin:rbacAssignBuiltinSuffix')}` : ''}{r.description ? ` — ${r.description}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {serverError ? <div className={styles.errorBox} role="alert">{serverError}</div> : null}
      </div>
    </Modal>
  );
}
