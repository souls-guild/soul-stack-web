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
import { normalizePermissionCatalog } from './permissions';
import { prettyRbacError } from './errors';
import styles from '../common.module.css';

// Role permission editing on the dedicated route /rbac/roles/:name/edit — a full page
// (was a cramped modal). Replace semantics: PATCH /v1/roles/{name}/permissions takes the
// full set. Builtin roles are read-only (submit blocked, mirrors the server 409). The role
// is read from the shared ['rbac.roles'] list; graceful "not found" if it's missing.
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
  return <RoleEditForm role={role} />;
}

function RoleEditForm({ role }: { role: RoleView }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    handleSubmit,
    control,
    formState: { isSubmitting },
  } = useForm<EditPermissionsFormValues>({
    resolver: zodResolver(editPermissionsSchema),
    defaultValues: { permissions: [...(role.permissions ?? [])] },
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

  const mu = useMutation({
    mutationFn: (values: EditPermissionsFormValues) =>
      keeperApi.roles.updatePermissions(role.name, { permissions: values.permissions }),
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
          <Controller
            name="permissions"
            control={control}
            render={({ field }) => (
              <PermissionsEditor
                value={field.value ?? []}
                onChange={field.onChange}
                catalog={catalog}
                ariaLabel={t('admin:rbacPermissionsAria')}
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
