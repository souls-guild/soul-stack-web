import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/primitives';
import { keeperApi, type RoleView } from '../../api/keeper';
import { editPermissionsSchema, type EditPermissionsFormValues } from './schemas';
import { PermissionsEditor } from './PermissionsEditor';
import { InheritedCeilingPanel } from './InheritedCeilingPanel';
import { DerivedChildrenPanel } from './DerivedChildrenPanel';
import { RoleScopeField } from './RoleScopeField';
import { normalizePermissionCatalog } from './permissions';
import { callerPermissionGate, callerScopeFloor, parentBounds } from './roleCeiling';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { prettyRbacError } from './errors';
import styles from '../common.module.css';

// Role permission editing on the dedicated route /rbac/roles/:name/edit — a full page
// (was a cramped modal). Replace semantics: PATCH /v1/roles/{name}/permissions takes the
// full set. Builtin roles are read-only (submit blocked, mirrors the server 409). The role
// is read from the shared ['rbac.roles'] list; graceful "not found" if it's missing.
//
// A DERIVED role (parent_role, ADR-078) is edited under its parent's ceiling: the picker
// offers a subset of the parent's resolved set and the scope field is the delta. The
// derivation itself is not re-rooted here — parent_role is omitted from the PATCH, which
// leaves it untouched (presence semantics).
export function RoleEditPage() {
  const { t } = useTranslation();
  const params = useParams<{ name: string }>();
  const roleName = decodeURIComponent(params.name ?? '');

  const rolesQ = useQuery({
    queryKey: ['rbac.roles'],
    queryFn: () => keeperApi.roles.list(),
  });
  const role = (rolesQ.data?.items ?? []).find((r) => r.name === roleName);

  if (rolesQ.isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>{t('loading')}</div>
      </div>
    );
  }

  if (!role) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <div className={styles.crumbs}>
              <Link to="/rbac">RBAC</Link> / edit
            </div>
            <h1 className={styles.title}>{t('admin:rbacRoleNotFound', { name: roleName })}</h1>
          </div>
        </div>
        <Link to="/rbac">{t('back')}</Link>
      </div>
    );
  }

  // Mount the form once the role is loaded so defaultValues are stable.
  return <RoleEditForm role={role} roles={rolesQ.data?.items ?? []} />;
}

function RoleEditForm({ role, roles }: { role: RoleView; roles: readonly RoleView[] }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    handleSubmit,
    control,
    watch,
    formState: { isSubmitting },
  } = useForm<EditPermissionsFormValues>({
    resolver: zodResolver(editPermissionsSchema),
    defaultValues: {
      permissions: [...(role.permissions ?? [])],
      defaultScope: role.default_scope ?? '',
    },
  });

  const parentView = role.parent_role ? roles.find((r) => r.name === role.parent_role) : undefined;
  const parent = useMemo(() => (parentView ? parentBounds(parentView) : undefined), [parentView]);
  const children = useMemo(() => roles.filter((r) => r.parent_role === role.name), [roles, role.name]);

  const { permissions: myPerms } = useMyPermissions();
  const callerLimit = useMemo(() => callerPermissionGate(myPerms), [myPerms]);

  // Same bound as on creation: a plain role edited by a scope-restricted caller must
  // still stay inside what that caller holds, or the PATCH comes back 403.
  const editedPermissions = watch('permissions');
  const callerFloor = useMemo(
    () => (parent ? '' : callerScopeFloor(callerLimit, editedPermissions)),
    [callerLimit, parent, editedPermissions],
  );

  const permsQ = useQuery({
    queryKey: ['rbac.permissions'],
    queryFn: () => keeperApi.permissions.list(),
    retry: false,
  });
  const catalog = useMemo(
    () => normalizePermissionCatalog(permsQ.data?.items ?? undefined),
    [permsQ.data],
  );

  const mu = useMutation({
    mutationFn: (values: EditPermissionsFormValues) =>
      keeperApi.roles.updatePermissions(role.name, {
        permissions: values.permissions,
        // Present (incl. null) replaces; '' clears the scope entirely.
        default_scope: values.defaultScope ? values.defaultScope : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rbac.roles'] });
      nav('/rbac');
    },
    onError: (err) => setServerError(prettyRbacError(err)),
  });

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.crumbs}>
            <Link to="/rbac">RBAC</Link> / edit
          </div>
          <h1 className={styles.title}>{t('forms:editPermissionsTitle', { name: role.name })}</h1>
        </div>
      </div>

      <form noValidate onSubmit={handleSubmit((v) => { setServerError(null); mu.mutate(v); })}>
        <section className={styles.section}>
          {role.builtin ? (
            <div
              style={{
                padding: 12,
                background: 'color-mix(in srgb, var(--warning, #b07f00) 8%, var(--surface))',
                border: '1px solid color-mix(in srgb, var(--warning, #b07f00) 30%, var(--border))',
                borderRadius: 'var(--radius)',
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              {t('admin:rbacEditBuiltinWarn')}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
              {t('admin:rbacEditReplaceProse')}
            </p>
          )}
          {parent ? (
            <div style={{ marginBottom: 14 }}>
              <InheritedCeilingPanel parent={parent.role} roles={roles} />
            </div>
          ) : null}
          <DerivedChildrenPanel children={children} />
          {role.parent_role && !parent ? (
            <div data-testid="parent-unresolved" style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 12 }}>
              {t('admin:rbacParentUnresolved', { name: role.parent_role })}
            </div>
          ) : null}
          <Controller
            name="permissions"
            control={control}
            render={({ field }) => (
              <PermissionsEditor
                value={field.value ?? []}
                onChange={field.onChange}
                catalog={catalog}
                ariaLabel={t('admin:rbacPermissionsAria')}
                parent={parent}
                callerLimit={callerLimit}
              />
            )}
          />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            {parent ? t('admin:rbacRoleScopeDeltaTitle') : t('admin:rbacRoleScopeTitle')}
          </h2>
          <Controller
            name="defaultScope"
            control={control}
            render={({ field }) => (
              <RoleScopeField
                onChange={field.onChange}
                initial={role.default_scope ?? ''}
                parent={parent}
                callerFloor={callerFloor}
              />
            )}
          />
        </section>

        {serverError ? <div className={styles.errorBox} role="alert">{serverError}</div> : null}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Button
            type="submit"
            variant="primary"
            disabled={isSubmitting || mu.isPending || role.builtin}
          >
            {mu.isPending ? t('saving') : t('save')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => nav('/rbac')}>
            {t('cancel')}
          </Button>
        </div>
      </form>
    </div>
  );
}
