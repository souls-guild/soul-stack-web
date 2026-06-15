import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from '../../components/primitives';
import { keeperApi, type RoleView, type PermissionResource } from '../../api/keeper';
import { editPermissionsSchema, type EditPermissionsFormValues } from './schemas';
import { PermissionsEditor } from './PermissionsEditor';
import { prettyRbacError } from './errors';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  role: RoleView;
  onClose: () => void;
  catalog: readonly PermissionResource[];
}

// Replace-семантика permissions роли — PATCH /v1/roles/{name}/permissions
// принимает полный набор. Сервер вернёт 409 role-builtin для builtin-ролей,
// 409 would-lock-out-cluster при снятии последнего `*`.
export function EditPermissionsModal({ open, role, onClose, catalog }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    handleSubmit,
    control,
    reset,
    formState: { isSubmitting },
  } = useForm<EditPermissionsFormValues>({
    resolver: zodResolver(editPermissionsSchema),
    defaultValues: { permissions: [...(role.permissions ?? [])] },
  });

  const mu = useMutation({
    mutationFn: (values: EditPermissionsFormValues) =>
      keeperApi.roles.updatePermissions(role.name, { permissions: values.permissions }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rbac.roles'] });
      reset();
      onClose();
    },
    onError: (err) => setServerError(prettyRbacError(err)),
  });

  function close() {
    if (mu.isPending) return;
    setServerError(null);
    reset({ permissions: [...(role.permissions ?? [])] });
    onClose();
  }

  return (
    <Modal
      open={open}
      title={t('forms:editPermissionsTitle', { name: role.name })}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={isSubmitting || mu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={isSubmitting || mu.isPending || role.builtin}
            onClick={handleSubmit((v) => { setServerError(null); mu.mutate(v); })}
          >
            {mu.isPending ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <form noValidate>
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
        {serverError ? <div className={styles.errorBox} style={{ marginTop: 12 }} role="alert">{serverError}</div> : null}
      </form>
    </Modal>
  );
}
