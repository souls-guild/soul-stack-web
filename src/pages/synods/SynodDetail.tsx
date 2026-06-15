import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, UserPlus, ShieldPlus, Pencil } from 'lucide-react';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button } from '../../components/primitives';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { EditSynodModal } from './EditSynodModal';
import { AddOperatorModal } from './AddOperatorModal';
import { GrantRoleModal } from './GrantRoleModal';
import { prettySynodError } from './errors';
import styles from '../common.module.css';

function chipStyle() {
  return {
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    gap: 4,
    padding: '2px 6px 2px 8px',
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-pill)',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
  };
}

function removeBtn(onClick: () => void, ariaLabel: string, disabled: boolean) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      style={{
        border: 0,
        background: 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: 'var(--text-muted)',
        padding: 0,
        display: 'inline-flex',
      }}
    >
      <X size={12} />
    </button>
  );
}

export function SynodDetail() {
  const { t } = useTranslation(['synods', 'common', 'errors']);
  const { name = '' } = useParams<{ name: string }>();
  const qc = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [addOpOpen, setAddOpOpen] = useState(false);
  const [grantRoleOpen, setGrantRoleOpen] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  const { hasPermission } = useMyPermissions();
  const canEdit = hasPermission('synod.update');
  const canAddOp = hasPermission('synod.add-operator');
  const canRemoveOp = hasPermission('synod.remove-operator');
  const canGrantRole = hasPermission('synod.grant-role');
  const canRevokeRole = hasPermission('synod.revoke-role');

  // Используем list и фильтруем по имени — у API нет GET /v1/synods/{name}.
  // Если добавят — заменить на keeperApi.synods.get(name).
  const synodsQ = useQuery({
    queryKey: ['synods'],
    queryFn: () => keeperApi.synods.list(),
    enabled: Boolean(name),
  });

  const synod = (synodsQ.data?.items ?? []).find((s) => s.name === name);

  const removeOpMut = useMutation({
    mutationFn: (aid: string) => keeperApi.synods.operators.remove(name, aid),
    onSuccess: () => { setMemberError(null); qc.invalidateQueries({ queryKey: ['synods'] }); },
    onError: (err) => setMemberError(prettySynodError(err)),
  });

  const revokeRoleMut = useMutation({
    mutationFn: (roleName: string) => keeperApi.synods.roles.revoke(name, roleName),
    onSuccess: () => { setRoleError(null); qc.invalidateQueries({ queryKey: ['synods'] }); },
    onError: (err) => setRoleError(prettySynodError(err)),
  });

  if (synodsQ.isLoading) {
    return <div className={styles.loading}>{t('common:loading')}</div>;
  }

  if (synodsQ.error) {
    return (
      <div className={styles.errorBox}>
        {synodsQ.error instanceof ApiError
          ? t('errors:generic', { status: synodsQ.error.status, detail: synodsQ.error.message })
          : String(synodsQ.error)}
      </div>
    );
  }

  if (!synod) {
    return <div className={styles.empty}>{t('errors:synodNotFound')}</div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.crumbs}>
        <Link to="/synods">synods</Link> / <span className="mono">{synod.name}</span>
      </div>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{synod.name}</h1>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
            {synod.builtin ? <Badge tone="info">{t('synods:builtin')}</Badge> : null}
            {synod.description ? (
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{synod.description}</span>
            ) : null}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          disabled={!canEdit}
          title={!canEdit ? t('synods:noPermUpdate') : t('synods:editSynod')}
          onClick={() => setEditOpen(true)}
          data-testid="edit-synod-btn"
        >
          <Pencil size={14} style={{ marginRight: 6 }} />
          {t('synods:editSynod')}
        </Button>
      </div>

      {/* Members section */}
      <section className={styles.section} aria-label="members">
        <h2 className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{t('synods:members')}</span>
          <span style={{ flex: 1 }} />
          {canAddOp ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setMemberError(null); setAddOpOpen(true); }}
              data-testid="add-operator-btn"
            >
              <UserPlus size={14} style={{ marginRight: 6 }} />
              {t('synods:addOperator')}
            </Button>
          ) : null}
        </h2>
        {memberError ? (
          <div className={styles.errorBox} role="alert" style={{ marginBottom: 8 }}>
            {memberError}
          </div>
        ) : null}
        {(synod.operators ?? []).length === 0 ? (
          <div className={styles.empty} style={{ padding: 'var(--s-3)' }}>
            {t('synods:noMembers')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(synod.operators ?? []).map((aid) => (
              <span key={aid} style={chipStyle()}>
                <Link
                  to={`/archons/${encodeURIComponent(aid)}`}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  {aid}
                </Link>
                {canRemoveOp
                  ? removeBtn(
                      () => { setMemberError(null); removeOpMut.mutate(aid); },
                      t('synods:removeOperatorAria', { aid }),
                      removeOpMut.isPending,
                    )
                  : null}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Roles section */}
      <section className={styles.section} aria-label="group-roles">
        <h2 className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{t('synods:roles')}</span>
          <span style={{ flex: 1 }} />
          {canGrantRole ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setRoleError(null); setGrantRoleOpen(true); }}
              data-testid="grant-role-btn"
            >
              <ShieldPlus size={14} style={{ marginRight: 6 }} />
              {t('synods:grantRole')}
            </Button>
          ) : null}
        </h2>
        {roleError ? (
          <div className={styles.errorBox} role="alert" style={{ marginBottom: 8 }}>
            {roleError}
          </div>
        ) : null}
        {(synod.roles ?? []).length === 0 ? (
          <div className={styles.empty} style={{ padding: 'var(--s-3)' }}>
            {t('synods:noRoles')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(synod.roles ?? []).map((r) => (
              <span key={r} style={chipStyle()}>
                <Link
                  to="/rbac"
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  {r}
                </Link>
                {canRevokeRole
                  ? removeBtn(
                      () => { setRoleError(null); revokeRoleMut.mutate(r); },
                      t('synods:revokeRoleAria', { role: r }),
                      revokeRoleMut.isPending,
                    )
                  : null}
              </span>
            ))}
          </div>
        )}
      </section>

      {editOpen ? (
        <EditSynodModal
          open={true}
          synod={synod}
          onClose={() => setEditOpen(false)}
        />
      ) : null}
      <AddOperatorModal
        open={addOpOpen}
        synodName={name}
        currentMembers={synod.operators ?? []}
        onClose={() => setAddOpOpen(false)}
      />
      <GrantRoleModal
        open={grantRoleOpen}
        synodName={name}
        currentRoles={synod.roles ?? []}
        onClose={() => setGrantRoleOpen(false)}
      />
    </div>
  );
}
