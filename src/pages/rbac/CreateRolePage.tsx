import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { roleCreateSchema, type RoleCreateFormValues } from './schemas';
import { PermissionsEditor } from './PermissionsEditor';
import { ParentRoleSelect } from './ParentRoleSelect';
import { InheritedCeilingPanel } from './InheritedCeilingPanel';
import { RoleScopeField, type ScopeMode } from './RoleScopeField';
import { normalizePermissionCatalog } from './permissions';
import { callerPermissionGate, parentBounds } from './roleCeiling';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { prettyRbacError } from './errors';
import styles from '../common.module.css';

// Role creation on the dedicated route /rbac/roles/new (NIM-80): name, description,
// permission set (action-wildcard + scope + bulk-apply — shared PermissionsEditor),
// roleCreateSchema validation. Fetches the catalog itself (shared ['rbac.permissions']).
// Success → back to /rbac.
//
// Derived roles (NIM-182, ADR-078): picking a parent bounds the whole form by that role
// — the permission picker offers a subset of the parent's RESOLVED set, the scope field
// becomes the attenuating delta under the parent's ceiling, and the panel above spells
// out what is inherited. The catalog's effective_* fields are the source of that bound;
// the UI never re-derives inheritance, and the server refuses anything beyond it (403).
export function CreateRolePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RoleCreateFormValues>({
    resolver: zodResolver(roleCreateSchema),
    defaultValues: { name: '', description: '', permissions: [], parentRole: '', defaultScope: '' },
  });

  const permsQ = useQuery({
    queryKey: ['rbac.permissions'],
    queryFn: () => keeperApi.permissions.list(),
    retry: false,
  });
  const catalog = useMemo(
    () => normalizePermissionCatalog(permsQ.data?.items ?? undefined),
    [permsQ.data],
  );

  // The role catalog feeds the parent selector and its ceiling. Graceful degradation: a
  // caller without role.list simply gets no derivation controls (a plain role still works).
  const rolesQ = useQuery({
    queryKey: ['rbac.roles'],
    queryFn: () => keeperApi.roles.list(),
    retry: false,
  });
  const roles = useMemo(() => rolesQ.data?.items ?? [], [rolesQ.data]);

  // Synods also grant roles (ADR-049), so "roles you hold" is direct membership ∪ synod
  // membership. Optional: a caller without synod.list just sees the direct half.
  const synodsQ = useQuery({
    queryKey: ['rbac.synods-for-parent'],
    queryFn: () => keeperApi.synods.list(),
    retry: false,
  });

  const parentRole = watch('parentRole');
  const parentView = roles.find((r) => r.name === parentRole);
  // Memoized on the resolved parent: ParentBounds caches per-base ceilings, and a fresh
  // object every render would defeat the memoized scope builders below.
  const parent = useMemo(() => (parentView ? parentBounds(parentView) : undefined), [parentView]);

  // The caller's own rights are a hard ceiling on any grant — showing the rest of the
  // catalog only invites a 403 on submit.
  const { permissions: myPerms } = useMyPermissions();
  const callerLimit = useMemo(() => callerPermissionGate(myPerms), [myPerms]);

  // A scoped operator gets `pin` by default: with `track`, a later widening of the parent
  // silently widens this role too, and the operator delegating here is by definition not
  // the one who should absorb that. An unrestricted caller keeps `track` — they own the
  // parent as well, so following it is the point. Null until the operator decides.
  const [scopeMode, setScopeMode] = useState<ScopeMode | null>(null);
  const effectiveMode: ScopeMode = scopeMode ?? (callerLimit ? 'pin' : 'track');


  const mu = useMutation({
    mutationFn: (values: RoleCreateFormValues) =>
      keeperApi.roles.create({
        name: values.name,
        description: values.description || undefined,
        permissions: values.permissions.length > 0 ? values.permissions : undefined,
        parent_role: values.parentRole || undefined,
        default_scope: values.defaultScope || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rbac.roles'] });
      nav('/rbac');
    },
    onError: (err) => setServerError(prettyRbacError(err)),
  });

  function onSubmit(values: RoleCreateFormValues) {
    setServerError(null);
    mu.mutate(values);
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.crumbs}>
            <Link to="/rbac">RBAC</Link> / new role
          </div>
          <h1 className={styles.title}>{t('forms:createRoleTitle')}</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <section className={styles.section}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(220px, 300px) minmax(0, 1fr)',
              gap: 'var(--s-4)',
              alignItems: 'start',
            }}
          >
            <Input
              label={t('admin:rbacRoleName')}
              mono
              placeholder={t('admin:rbacRoleNamePlaceholder')}
              aria-invalid={errors.name ? 'true' : undefined}
              error={errors.name?.message ? t(errors.name.message) : undefined}
              {...register('name')}
            />
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 13 }}>{t('admin:rbacDescription')}</span>
              <textarea
                rows={3}
                placeholder={t('admin:rbacDescriptionPlaceholder')}
                spellCheck={false}
                aria-invalid={errors.description ? 'true' : undefined}
                {...register('description')}
                // Grow downward as the description gets longer, then scroll past the cap.
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
                }}
                style={{
                  width: '100%',
                  minHeight: 84,
                  maxHeight: 320,
                  padding: 10,
                  borderRadius: 'var(--radius)',
                  border: `1px solid ${errors.description ? 'var(--danger)' : 'var(--border)'}`,
                  background: 'var(--surface)',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  resize: 'vertical',
                }}
              />
              {errors.description ? (
                <span style={{ color: 'var(--danger)', fontSize: 12 }}>
                  {errors.description.message ? t(errors.description.message) : null}
                </span>
              ) : null}
            </label>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('admin:rbacDerivationTitle')}</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(220px, 300px) minmax(0, 1fr)',
              gap: 'var(--s-4)',
              alignItems: 'start',
            }}
          >
            <Controller
              name="parentRole"
              control={control}
              render={({ field }) => (
                <ParentRoleSelect
                  roles={roles}
                  synods={synodsQ.data?.items ?? undefined}
                  value={field.value ?? ''}
                  unavailable={Boolean(rolesQ.error)}
                  onChange={(next) => {
                    field.onChange(next);
                    // Re-rooting invalidates the picked set and the delta: what was inside
                    // the old parent is arbitrary under the new one, and keeping it would
                    // silently submit rights the operator never reviewed.
                    setValue('permissions', []);
                    setValue('defaultScope', '');
                    setScopeMode(null);
                  }}
                />
              )}
            />
            {parent ? <InheritedCeilingPanel parent={parent.role} roles={roles} /> : null}
          </div>
          {errors.parentRole ? (
            <span
              role="alert"
              data-testid="parent-role-error"
              style={{ color: 'var(--danger)', fontSize: 12, marginTop: 6, display: 'block' }}
            >
              {t('admin:rbacErrParentRequired')}
            </span>
          ) : null}
        </section>

        {/* Both sections are meaningless before a parent is chosen — the delta narrows
            the parent's scope, and the permission set is a subset of the parent's. Shown
            only once there is a ceiling to read them against, so nothing picked here can
            be silently discarded by a later re-root. */}
        {parent ? (
          <>
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{t('admin:rbacRoleScopeDeltaTitle')}</h2>
              <Controller
                name="defaultScope"
                control={control}
                render={({ field }) => (
                  // Keyed by parent so switching parents remounts the builder on the cleared value.
                  <RoleScopeField
                    key={parentRole}
                    onChange={field.onChange}
                    parent={parent}
                    mode={effectiveMode}
                    onModeChange={setScopeMode}
                  />
                )}
              />
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{t('admin:rbacPermissionsTitle')}</h2>
              <Controller
                name="permissions"
                control={control}
                render={({ field }) => (
                  <PermissionsEditor
                    key={parentRole}
                    value={field.value ?? []}
                    onChange={field.onChange}
                    catalog={catalog}
                    ariaLabel={t('admin:rbacPermissionsAria')}
                    parent={parent}
                    callerLimit={callerLimit}
                  />
                )}
              />
              <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, display: 'block' }}>
                {t('admin:rbacPermissionsHint')}
              </span>
              {errors.permissions ? (
                <span role="alert" style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4, display: 'block' }}>
                  {t('admin:rbacErrPermissionsInvalid')}
                </span>
              ) : null}
            </section>
          </>
        ) : (
          <section className={styles.section} data-testid="awaiting-parent">
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {t('admin:rbacAwaitingParent')}
            </span>
          </section>
        )}

        {serverError ? <div className={styles.errorBox} role="alert">{serverError}</div> : null}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Button type="submit" variant="primary" disabled={isSubmitting || mu.isPending}>
            {mu.isPending ? t('creating') : t('create')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => nav('/rbac')}>
            {t('cancel')}
          </Button>
        </div>
      </form>
    </div>
  );
}
