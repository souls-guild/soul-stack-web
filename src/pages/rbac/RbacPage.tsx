import { useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, ShieldPlus, Trash2, UserPlus, X } from 'lucide-react';
import { keeperApi, type RoleView } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button } from '../../components/primitives';
import { DeleteRoleModal } from './DeleteRoleModal';
import { EditPermissionsModal } from './EditPermissionsModal';
import { AssignRoleModal } from './AssignRoleModal';
import { normalizePermissionCatalog } from './permissions';
import { prettyRbacError } from './errors';
import styles from '../common.module.css';

type Tab = 'roles' | 'permissions' | 'members';

interface RolesTabProps {
  roles: RoleView[];
  onEdit: (r: RoleView) => void;
  onDelete: (r: RoleView) => void;
}

function RolesTab({ roles, onEdit, onDelete }: RolesTabProps) {
  const { t } = useTranslation();
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Name</th>
          <th>Builtin</th>
          <th>Description</th>
          <th>Permissions</th>
          <th>Archons</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {roles.map((r) => (
          <tr key={r.name}>
            <td className="mono">{r.name}</td>
            <td>{r.builtin ? <Badge tone="info">builtin</Badge> : '—'}</td>
            <td>{r.description ?? '—'}</td>
            <td className="mono">{(r.permissions ?? []).length}</td>
            <td className="mono">{(r.operators ?? []).length}</td>
            <td>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  aria-label={t('forms:ariaEditPermissions', { name: r.name })}
                  title={r.builtin ? t('pages:builtinEditDenied') : t('admin:rbacBuiltinEditTitle')}
                  onClick={() => onEdit(r)}
                  style={iconBtn(false)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  aria-label={t('forms:ariaDeleteRole', { name: r.name })}
                  title={r.builtin ? t('pages:builtinDeleteDenied') : t('admin:rbacBuiltinDeleteTitle')}
                  disabled={r.builtin}
                  onClick={() => onDelete(r)}
                  style={iconBtn(true, r.builtin)}
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
        </section>
      ))}
    </div>
  );
}

interface MembersTabProps {
  roles: RoleView[];
  // Все операторы кластера (для inline-assign к оператору без ролей).
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

  // Перестраиваем «роль → операторы» в «оператор → роли».
  const byOperator = useMemo(() => {
    const acc = new Map<string, string[]>();
    for (const r of roles) {
      for (const aid of (r.operators ?? [])) {
        const prev = acc.get(aid);
        if (prev) prev.push(r.name);
        else acc.set(aid, [r.name]);
      }
    }
    // Добавим operators без ролей — чтобы было видно, кому assign-ить.
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
            <th>AID</th>
            <th>Roles</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {byOperator.map(([aid, rs]) => (
            <tr key={aid}>
              <td className="mono">
                {/* AID кликабелен — ведёт на карточку архонта */}
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
  const [editing, setEditing] = useState<RoleView | null>(null);
  const [deleting, setDeleting] = useState<RoleView | null>(null);
  const [assigningAid, setAssigningAid] = useState<string | null>(null);

  const rolesQ = useQuery({
    queryKey: ['rbac.roles'],
    queryFn: () => keeperApi.roles.list(),
  });

  // operators.list — нужен только на табе members, чтобы показать
  // Архонтов без ролей. На roles/permissions табах не дёргаем.
  const operatorsQ = useQuery({
    queryKey: ['rbac.operators-for-assign'],
    queryFn: () => keeperApi.operators.list({ limit: 200 }),
    enabled: tab === 'members',
  });

  const roles = useMemo(() => rolesQ.data?.items ?? [], [rolesQ.data]);
  const operators = operatorsQ.data?.items ?? [];

  // Каталог permissions — из backend. Недоступен/пуст → graceful (picker
  // покажет hint, save всё равно сохранит уже имеющиеся права через preserved).
  const permsQ = useQuery({
    queryKey: ['rbac.permissions'],
    queryFn: () => keeperApi.permissions.list(),
    retry: false,
  });
  const catalog = useMemo(
    () => normalizePermissionCatalog(permsQ.data?.items ?? undefined),
    [permsQ.data],
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>RBAC</h1>
          <div className={styles.crumbs}>{t('pages:rbacCrumbs')}</div>
        </div>
        {tab === 'roles' ? (
          <Button type="button" variant="primary" onClick={() => nav('/rbac/roles/new')}>
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
          Roles
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'permissions'}
          className={`${styles.tab} ${tab === 'permissions' ? styles.tabActive : ''}`}
          onClick={() => setTab('permissions')}
        >
          Role permissions
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'members'}
          className={`${styles.tab} ${tab === 'members' ? styles.tabActive : ''}`}
          onClick={() => setTab('members')}
        >
          Archon assignments
        </button>
      </div>

      {rolesQ.isLoading ? <div className={styles.loading}>{t('loading')}</div> : null}
      {rolesQ.error ? (
        <div className={styles.errorBox}>
          {rolesQ.error instanceof ApiError
            ? t('errors:generic', { status: rolesQ.error.status, detail: rolesQ.error.message })
            : String(rolesQ.error)}
        </div>
      ) : null}

      {rolesQ.data && roles.length === 0 ? (
        <div className={styles.empty}>{t('pages:noRoles')}</div>
      ) : null}

      {roles.length > 0 ? (
        <>
          {tab === 'roles' ? (
            <RolesTab roles={roles} onEdit={setEditing} onDelete={setDeleting} />
          ) : null}
          {tab === 'permissions' ? (
            <PermissionsTab roles={roles} onEdit={setEditing} />
          ) : null}
          {tab === 'members' ? (
            <MembersTab roles={roles} operators={operators} onAssign={setAssigningAid} />
          ) : null}
        </>
      ) : null}

      {editing ? (
        <EditPermissionsModal
          open={true}
          role={editing}
          catalog={catalog}
          onClose={() => setEditing(null)}
        />
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
