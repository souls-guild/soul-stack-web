import { useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, ShieldPlus, Trash2, UserPlus, X } from 'lucide-react';
import { keeperApi, type RoleView } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { Badge, Button } from '../../components/primitives';
import { DeleteRoleModal } from './DeleteRoleModal';
import { AssignRoleModal } from './AssignRoleModal';
import { prettyRbacError } from './errors';
import styles from '../common.module.css';

type Tab = 'roles' | 'permissions' | 'members';

interface RolesTabProps {
  roles: RoleView[];
  onEdit: (r: RoleView) => void;
  onDelete: (r: RoleView) => void;
  canEdit: boolean;
  canDelete: boolean;
}

function RolesTab({ roles, onEdit, onDelete, canEdit, canDelete }: RolesTabProps) {
  const { t } = useTranslation();
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{t('colName')}</th>
          <th>{t('common:colBuiltin')}</th>
          <th>{t('colDerivedFrom')}</th>
          <th>{t('colDescription')}</th>
          <th>{t('colPermissions')}</th>
          <th>{t('common:colArchons')}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {roles.map((r) => (
          <tr key={r.name}>
            <td className="mono">{r.name}</td>
            <td>{r.builtin ? <Badge tone="info">builtin</Badge> : '—'}</td>
            {/* parent_role (ADR-078): a derived role is bounded by it — visible without opening the role. */}
            <td className="mono">
              {r.parent_role ? (
                <span data-testid={`role-parent-${r.name}`}>{r.parent_role}</span>
              ) : (
                '—'
              )}
            </td>
            <td>{r.description ?? '—'}</td>
            {/* Stored count, plus the resolved one when derivation attenuates it. */}
            <td className="mono">
              {(r.permissions ?? []).length}
              {r.parent_role && (r.effective_permissions ?? []).length !== (r.permissions ?? []).length ? (
                <span
                  title={t('admin:rbacEffectiveCountTitle')}
                  style={{ color: 'var(--text-faint)' }}
                >
                  {` → ${(r.effective_permissions ?? []).length}`}
                </span>
              ) : null}
            </td>
            <td className="mono">{(r.operators ?? []).length}</td>
            <td>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  aria-label={t('forms:ariaEditPermissions', { name: r.name })}
                  title={
                    !canEdit
                      ? t('admin:rbacNoRoleUpdate')
                      : r.builtin
                        ? t('pages:builtinEditDenied')
                        : t('admin:rbacBuiltinEditTitle')
                  }
                  disabled={!canEdit}
                  onClick={() => onEdit(r)}
                  style={iconBtn(false, !canEdit)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  aria-label={t('forms:ariaDeleteRole', { name: r.name })}
                  title={
                    !canDelete
                      ? t('admin:rbacNoRoleDelete')
                      : r.builtin
                        ? t('pages:builtinDeleteDenied')
                        : t('admin:rbacBuiltinDeleteTitle')
                  }
                  disabled={r.builtin || !canDelete}
                  onClick={() => onDelete(r)}
                  style={iconBtn(true, r.builtin || !canDelete)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

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

interface PermissionsTabProps {
  roles: RoleView[];
  onEdit: (r: RoleView) => void;
}

function PermissionsTab({ roles, onEdit }: PermissionsTabProps) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
      {roles.map((r) => (
        <section key={r.name} className={styles.section}>
          <h2 className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono">{r.name}</span>
            {r.builtin ? <Badge tone="info">builtin</Badge> : null}
            {r.parent_role ? (
              <span
                data-testid={`role-derived-badge-${r.name}`}
                style={{ fontSize: 11.5, color: 'var(--text-muted)' }}
              >
                {t('admin:rbacDerivedFrom', { name: r.parent_role })}
              </span>
            ) : null}
            <span style={{ flex: 1 }} />
            <Button
              type="button"
              variant="ghost"
              aria-label={t('forms:ariaEditPermissions', { name: r.name })}
              onClick={() => onEdit(r)}
            >
              <Pencil size={14} style={{ marginRight: 6 }} />
              {t('edit')}
            </Button>
          </h2>
          {r.description ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{r.description}</div>
          ) : null}
          {(r.permissions ?? []).length === 0 ? (
            <div className={styles.empty}>{t('pages:noPermissions')}</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(r.permissions ?? []).map((p) => (
                <code
                  key={p}
                  style={{
                    padding: '2px 8px',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-pill)',
                    fontSize: 12,
                  }}
                >
                  {p}
                </code>
              ))}
            </div>
          )}
          {/* A derived role's stored rows are not what it grants — the resolved form is. */}
          {r.parent_role ? (
            <div data-testid={`role-effective-${r.name}`} style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginBottom: 4 }}>
                {t('admin:rbacEffectiveHeading', { name: r.parent_role })}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(r.effective_permissions ?? []).map((p) => (
                  <code
                    key={p}
                    style={{
                      padding: '2px 8px',
                      background: 'color-mix(in srgb, var(--accent) 8%, var(--surface-2))',
                      border: '1px solid color-mix(in srgb, var(--accent) 26%, var(--border))',
                      borderRadius: 'var(--radius-pill)',
                      fontSize: 12,
                    }}
                  >
                    {p}
                  </code>
                ))}
                {(r.effective_permissions ?? []).length === 0 ? (
                  <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{t('pages:noPermissions')}</span>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

interface MembersTabProps {
  roles: RoleView[];
  // All operators in the cluster (for inline-assign to an operator without roles).
  operators: readonly { aid: string; revoked_at?: string | null }[];
  onAssign: (aid: string) => void;
}

function MembersTab({ roles, operators, onAssign }: MembersTabProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const revokeMut = useMutation({
    mutationFn: (vars: { role: string; aid: string }) =>
      keeperApi.roles.revokeOperator(vars.role, vars.aid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rbac.roles'] });
    },
    onError: (err) => setServerError(prettyRbacError(err)),
  });

  // Rebuild "role -> operators" into "operator -> roles".
  const byOperator = useMemo(() => {
    const acc = new Map<string, string[]>();
    for (const r of roles) {
      for (const aid of (r.operators ?? [])) {
        const prev = acc.get(aid);
        if (prev) prev.push(r.name);
        else acc.set(aid, [r.name]);
      }
    }
    // Add operators without roles — so it's visible who to assign to.
    for (const op of operators) {
      if (op.revoked_at) continue;
      if (!acc.has(op.aid)) acc.set(op.aid, []);
    }
    return Array.from(acc.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [roles, operators]);

  if (byOperator.length === 0) {
    return <div className={styles.empty}>{t('pages:noArchons')}</div>;
  }

  return (
    <>
      {serverError ? <div className={styles.errorBox} role="alert" style={{ marginBottom: 12 }}>{serverError}</div> : null}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t('common:colAid')}</th>
            <th>{t('colRoles')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {byOperator.map(([aid, rs]) => (
            <tr key={aid}>
              <td className="mono">
                {/* AID is clickable — links to the archon card */}
                <Link
                  to={`/archons/${encodeURIComponent(aid)}`}
                >
                  {aid}
                </Link>
              </td>
              <td>
                {rs.length === 0 ? (
                  <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{t('admin:rbacNoRolesForOperator')}</span>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {rs.map((rn) => (
                      <span
                        key={rn}
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
                        {rn}
                        <button
                          type="button"
                          aria-label={t('admin:rbacUnassignAria', { aid, role: rn })}
                          title={t('admin:rbacUnassignAria', { aid, role: rn })}
                          onClick={() => {
                            setServerError(null);
                            revokeMut.mutate({ role: rn, aid });
                          }}
                          disabled={revokeMut.isPending}
                          style={{
                            border: 0,
                            background: 'transparent',
                            cursor: revokeMut.isPending ? 'not-allowed' : 'pointer',
                            color: 'var(--text-muted)',
                            padding: 0,
                            display: 'inline-flex',
                          }}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </td>
              <td>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    aria-label={t('forms:ariaAssignRole', { aid })}
                    onClick={() => onAssign(aid)}
                    style={iconBtn(false)}
                  >
                    <UserPlus size={14} />
                    <span style={{ marginLeft: 4 }}>{t('admin:rbacAssign')}</span>
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function RbacPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('roles');
  const [deleting, setDeleting] = useState<RoleView | null>(null);
  const [assigningAid, setAssigningAid] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Actions the caller cannot perform are disabled rather than offered and 403'd.
  const { hasPermission } = useMyPermissions();
  const canCreate = hasPermission('role.create');
  const canEdit = hasPermission('role.update');
  const canDelete = hasPermission('role.delete');

  // Edit is a dedicated page (was a cramped modal) — same layout as Create.
  const editRole = (r: RoleView) => nav(`/rbac/roles/${encodeURIComponent(r.name)}/edit`);

  const rolesQ = useQuery({
    queryKey: ['rbac.roles'],
    queryFn: () => keeperApi.roles.list(),
  });

  // operators.list is only needed on the members tab, to show
  // Archons without roles. Not fetched on the roles/permissions tabs.
  const operatorsQ = useQuery({
    queryKey: ['rbac.operators-for-assign'],
    queryFn: () => keeperApi.operators.list({ limit: 200 }),
    enabled: tab === 'members',
  });

  const allRoles = useMemo(() => rolesQ.data?.items ?? [], [rolesQ.data]);
  const operators = operatorsQ.data?.items ?? [];

  // Name / description / parent filter — a real cluster's catalog outgrows one screen.
  const roles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRoles;
    return allRoles.filter(
      (r) =>
        r.name.toLowerCase().includes(q)
        || (r.description ?? '').toLowerCase().includes(q)
        || (r.parent_role ?? '').toLowerCase().includes(q),
    );
  }, [allRoles, search]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('common:navRbac')}</h1>
          <div className={styles.crumbs}>{t('pages:rbacCrumbs')}</div>
        </div>
        {tab === 'roles' ? (
          <Button
            type="button"
            variant="primary"
            disabled={!canCreate}
            title={canCreate ? undefined : t('admin:rbacNoRoleCreate')}
            onClick={() => nav('/rbac/roles/new')}
          >
            <ShieldPlus size={14} style={{ marginRight: 6 }} />
            {t('createRole')}
          </Button>
        ) : null}
      </div>

      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'roles'}
          className={`${styles.tab} ${tab === 'roles' ? styles.tabActive : ''}`}
          onClick={() => setTab('roles')}
        >
          {t('colRoles')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'permissions'}
          className={`${styles.tab} ${tab === 'permissions' ? styles.tabActive : ''}`}
          onClick={() => setTab('permissions')}
        >
          {t('admin:rbacTabRolePermissions')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'members'}
          className={`${styles.tab} ${tab === 'members' ? styles.tabActive : ''}`}
          onClick={() => setTab('members')}
        >
          {t('admin:rbacTabArchonAssignments')}
        </button>
      </div>

      {allRoles.length > 0 && tab !== 'members' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px' }}>
          <input
            type="text"
            data-testid="rbac-role-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin:rbacRoleSearch')}
            aria-label={t('admin:rbacRoleSearch')}
            style={{
              width: 280,
              fontSize: 13,
              padding: '6px 10px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
            {t('admin:rbacRoleCount', { shown: roles.length, total: allRoles.length })}
          </span>
        </div>
      ) : null}

      {rolesQ.isLoading ? <div className={styles.loading}>{t('loading')}</div> : null}
      {rolesQ.error ? (
        <div className={styles.errorBox}>
          {rolesQ.error instanceof ApiError
            ? t('errors:generic', { status: rolesQ.error.status, detail: rolesQ.error.message })
            : String(rolesQ.error)}
        </div>
      ) : null}

      {rolesQ.data && roles.length === 0 ? (
        <div className={styles.empty}>
          {allRoles.length > 0 ? t('admin:rbacRoleNoMatch') : t('pages:noRoles')}
        </div>
      ) : null}

      {roles.length > 0 ? (
        <>
          {tab === 'roles' ? (
            <RolesTab
              roles={roles}
              onEdit={editRole}
              onDelete={setDeleting}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          ) : null}
          {tab === 'permissions' ? (
            <PermissionsTab roles={roles} onEdit={editRole} />
          ) : null}
          {tab === 'members' ? (
            <MembersTab roles={allRoles} operators={operators} onAssign={setAssigningAid} />
          ) : null}
        </>
      ) : null}

      {deleting ? (
        <DeleteRoleModal
          open={true}
          role={deleting}
          onClose={() => setDeleting(null)}
        />
      ) : null}
      {assigningAid ? (
        <AssignRoleModal
          open={true}
          aid={assigningAid}
          roles={roles}
          onClose={() => setAssigningAid(null)}
        />
      ) : null}
    </div>
  );
}
