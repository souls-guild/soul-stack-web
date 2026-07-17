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
import { normalizePermissionCatalog } from './permissions';
import { prettyRbacError } from './errors';
import styles from '../common.module.css';

// Role creation on the dedicated route /rbac/roles/new (NIM-80): name, description,
// permission set (action-wildcard + scope + bulk-apply — shared PermissionsEditor),
// roleCreateSchema validation. Fetches the catalog itself (shared ['rbac.permissions']).
// Success → back to /rbac.
export function CreateRolePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<RoleCreateFormValues>({
    resolver: zodResolver(roleCreateSchema),
    defaultValues: { name: '', description: '', permissions: [] },
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
    mutationFn: (values: RoleCreateFormValues) =>
      keeperApi.roles.create({
        name: values.name,
        description: values.description || undefined,
        permissions: values.permissions.length > 0 ? values.permissions : undefined,
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
          <div className={styles.formFields}>
            <Input
              label="Name"
              mono
              placeholder={t('admin:rbacRoleNamePlaceholder')}
              aria-invalid={errors.name ? 'true' : undefined}
              error={errors.name?.message ? t(errors.name.message) : undefined}
              {...register('name')}
            />
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 13 }}>{t('admin:rbacDescription')}</span>
              <textarea
                rows={2}
                placeholder={t('admin:rbacDescriptionPlaceholder')}
                spellCheck={false}
                aria-invalid={errors.description ? 'true' : undefined}
                {...register('description')}
                style={{
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
          <h2 className={styles.sectionTitle}>Permissions</h2>
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
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, display: 'block' }}>
            {t('admin:rbacPermissionsHint')}
          </span>
          {errors.permissions ? (
            <span role="alert" style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4, display: 'block' }}>
              {t('admin:rbacErrPermissionsInvalid')}
            </span>
          ) : null}
        </section>

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
