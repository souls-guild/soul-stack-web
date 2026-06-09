import { type CSSProperties, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, UserPlus, ShieldPlus, Users2 } from 'lucide-react';
import { keeperApi, type SynodView } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button } from '../../components/primitives';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { CreateSynodModal } from './CreateSynodModal';
import { DeleteSynodModal } from './DeleteSynodModal';
import { AddOperatorModal } from './AddOperatorModal';
import { GrantRoleModal } from './GrantRoleModal';
import { prettySynodError } from './errors';
import styles from '../common.module.css';

function iconBtn(danger: boolean, disabled = false): CSSProperties {
  return {
    padding: '4px 8px',
    border: `1px solid ${danger ? 'var(--danger)' : 'var(--border)'}`,
    borderRadius: 'var(--radius)',
    background: 'transparent',
    color: disabled ? 'var(--text-faint)' : danger ? 'var(--danger)' : 'var(--text-muted)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 12,
  };
}

interface ChipProps {
  label: string;
  onRemove?: () => void;
  ariaLabel?: string;
  removeDisabled?: boolean;
  removeTitle?: string;
}

function chip({ label, onRemove, ariaLabel, removeDisabled, removeTitle }: ChipProps) {
  return (
    <span
      key={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 6px 2px 8px',
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-pill)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
      }}
    >
      {label}
      <button
        type="button"
        aria-label={ariaLabel}
        title={removeDisabled ? removeTitle : ariaLabel}
        disabled={removeDisabled}
        onClick={removeDisabled ? undefined : onRemove}
        style={{
          border: 0,
          background: 'transparent',
          cursor: removeDisabled ? 'not-allowed' : 'pointer',
          color: removeDisabled ? 'var(--text-faint)' : 'var(--text-muted)',
          padding: 0,
          display: 'inline-flex',
        }}
      >
        <X size={12} />
      </button>
    </span>
  );
}

interface SynodRowProps {
  synod: SynodView;
  onDelete: (s: SynodView) => void;
  onAddOperator: (s: SynodView) => void;
  onGrantRole: (s: SynodView) => void;
  canDelete: boolean;
  canAddOp: boolean;
  canRemoveOp: boolean;
  canGrantRole: boolean;
  canRevokeRole: boolean;
}

function SynodRow({
  synod,
  onDelete,
  onAddOperator,
  onGrantRole,
  canDelete,
  canAddOp,
  canRemoveOp,
  canGrantRole,
  canRevokeRole,
}: SynodRowProps) {
  const { t } = useTranslation(['synods', 'common']);
  const qc = useQueryClient();
  const [rowError, setRowError] = useState<string | null>(null);

  const removeOpMut = useMutation({
    mutationFn: (aid: string) => keeperApi.synods.operators.remove(synod.name, aid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['synods'] }),
    onError: (err) => setRowError(prettySynodError(err)),
  });

  const revokeRoleMut = useMutation({
    mutationFn: (roleName: string) => keeperApi.synods.roles.revoke(synod.name, roleName),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['synods'] }),
    onError: (err) => setRowError(prettySynodError(err)),
  });

  return (
    <>
      {rowError ? (
        <tr>
          <td colSpan={5}>
            <div className={styles.errorBox} role="alert">{rowError}</div>
          </td>
        </tr>
      ) : null}
      <tr>
        <td className="mono">
          <Link to={`/synods/${encodeURIComponent(synod.name)}`}>{synod.name}</Link>
        </td>
        <td>
          {synod.builtin ? <Badge tone="info">{t('synods:builtin')}</Badge> : '—'}
        </td>
        <td>{synod.description ?? '—'}</td>
        <td>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
            {synod.operators.length === 0 ? (
              <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>—</span>
            ) : (
              synod.operators.map((aid) =>
                chip({
                  label: aid,
                  onRemove: () => { setRowError(null); removeOpMut.mutate(aid); },
                  ariaLabel: t('synods:removeOperatorAria', { aid }),
                  removeDisabled: !canRemoveOp,
                  removeTitle: t('synods:noPermRemoveOp'),
                }),
              )
            )}
            <button
              type="button"
              aria-label={t('synods:addOperator')}
              title={!canAddOp ? t('synods:noPermAddOp') : t('synods:addOperator')}
              disabled={!canAddOp}
              onClick={canAddOp ? () => { setRowError(null); onAddOperator(synod); } : undefined}
              style={iconBtn(false, !canAddOp)}
              data-testid={`add-operator-${synod.name}`}
            >
              <UserPlus size={12} />
            </button>
          </div>
        </td>
        <td>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
            {synod.roles.length === 0 ? (
              <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>—</span>
            ) : (
              synod.roles.map((r) =>
                chip({
                  label: r,
                  onRemove: () => { setRowError(null); revokeRoleMut.mutate(r); },
                  ariaLabel: t('synods:revokeRoleAria', { role: r }),
                  removeDisabled: !canRevokeRole,
                  removeTitle: t('synods:noPermRevokeRole'),
                }),
              )
            )}
            <button
              type="button"
              aria-label={t('synods:grantRole')}
              title={!canGrantRole ? t('synods:noPermGrantRole') : t('synods:grantRole')}
              disabled={!canGrantRole}
              onClick={canGrantRole ? () => { setRowError(null); onGrantRole(synod); } : undefined}
              style={iconBtn(false, !canGrantRole)}
              data-testid={`grant-role-${synod.name}`}
            >
              <ShieldPlus size={12} />
            </button>
          </div>
        </td>
        <td>
          <button
            type="button"
            aria-label={t('synods:deleteSynod')}
            title={synod.builtin ? t('synods:builtinDeleteDenied') : t('synods:deleteSynod')}
            disabled={synod.builtin || !canDelete}
            onClick={() => onDelete(synod)}
            style={iconBtn(true, synod.builtin || !canDelete)}
            data-testid={`delete-synod-${synod.name}`}
          >
            <X size={14} />
          </button>
        </td>
      </tr>
    </>
  );
}

export function SynodsList() {
  const { t } = useTranslation(['synods', 'common']);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<SynodView | null>(null);
  const [addingOpTo, setAddingOpTo] = useState<SynodView | null>(null);
  const [grantingRoleTo, setGrantingRoleTo] = useState<SynodView | null>(null);

  const { hasPermission } = useMyPermissions();

  const canCreate = hasPermission('synod.create');
  const canDelete = hasPermission('synod.delete');
  const canAddOp = hasPermission('synod.add-operator');
  const canRemoveOp = hasPermission('synod.remove-operator');
  const canGrantRole = hasPermission('synod.grant-role');
  const canRevokeRole = hasPermission('synod.revoke-role');

  const synodsQ = useQuery({
    queryKey: ['synods'],
    queryFn: () => keeperApi.synods.list(),
  });

  const synods = synodsQ.data?.items ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('synods:title')}</h1>
          <div className={styles.crumbs}>{t('synods:crumbs')}</div>
        </div>
        <Button
          type="button"
          variant="primary"
          disabled={!canCreate}
          title={!canCreate ? t('synods:noPermCreate') : undefined}
          onClick={() => setCreateOpen(true)}
          data-testid="create-synod-btn"
        >
          <Users2 size={14} style={{ marginRight: 6 }} />
          {t('synods:createSynod')}
        </Button>
      </div>

      {synodsQ.isLoading ? (
        <div className={styles.loading}>{t('common:loading')}</div>
      ) : null}

      {synodsQ.error ? (
        <div className={styles.errorBox}>
          {synodsQ.error instanceof ApiError
            ? t('errors:generic', { status: synodsQ.error.status, detail: synodsQ.error.message })
            : String(synodsQ.error)}
        </div>
      ) : null}

      {synodsQ.data && synods.length === 0 ? (
        <div className={styles.empty}>{t('synods:noSynods')}</div>
      ) : null}

      {synods.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Builtin</th>
              <th>Description</th>
              <th>{t('synods:members')}</th>
              <th>{t('synods:roles')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {synods.map((s) => (
              <SynodRow
                key={s.name}
                synod={s}
                onDelete={setDeleting}
                onAddOperator={setAddingOpTo}
                onGrantRole={setGrantingRoleTo}
                canDelete={canDelete}
                canAddOp={canAddOp}
                canRemoveOp={canRemoveOp}
                canGrantRole={canGrantRole}
                canRevokeRole={canRevokeRole}
              />
            ))}
          </tbody>
        </table>
      ) : null}

      <CreateSynodModal open={createOpen} onClose={() => setCreateOpen(false)} />

      {deleting ? (
        <DeleteSynodModal
          open={true}
          synod={deleting}
          onClose={() => setDeleting(null)}
        />
      ) : null}

      {addingOpTo ? (
        <AddOperatorModal
          open={true}
          synodName={addingOpTo.name}
          onClose={() => setAddingOpTo(null)}
        />
      ) : null}

      {grantingRoleTo ? (
        <GrantRoleModal
          open={true}
          synodName={grantingRoleTo.name}
          currentRoles={grantingRoleTo.roles}
          onClose={() => setGrantingRoleTo(null)}
        />
      ) : null}
    </div>
  );
}
