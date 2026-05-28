import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { roleCreateSchema, type RoleCreateFormValues } from './schemas';
import { PermissionsEditor } from './PermissionsEditor';
import { prettyRbacError } from './errors';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  catalog: readonly string[];
}

export function CreateRoleModal({ open, onClose, catalog }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RoleCreateFormValues>({
    resolver: zodResolver(roleCreateSchema),
    defaultValues: { name: '', description: '', permissions: [] },
  });

  const mu = useMutation({
    mutationFn: (values: RoleCreateFormValues) =>
      keeperApi.roles.create({
        name: values.name,
        description: values.description || undefined,
        permissions: values.permissions.length > 0 ? values.permissions : undefined,
      }),
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
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      title={t('forms:createRoleTitle')}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={isSubmitting || mu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={isSubmitting || mu.isPending}
            onClick={handleSubmit((v) => { setServerError(null); mu.mutate(v); })}
          >
            {mu.isPending ? t('creating') : t('create')}
          </Button>
        </>
      }
    >
      <form noValidate>
        <Input
          label="Name"
          mono
          placeholder="soul-operator"
          aria-invalid={errors.name ? 'true' : undefined}
          error={errors.name?.message}
          {...register('name')}
        />
        <div style={{ height: 12 }} />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13 }}>Description</span>
          <textarea
            rows={2}
            placeholder="Управление Soul-ами, чтение состояния флота"
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
            <span style={{ color: 'var(--danger)', fontSize: 12 }}>{errors.description.message}</span>
          ) : null}
        </label>
        <div style={{ height: 12 }} />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13 }}>Permissions</span>
          <Controller
            name="permissions"
            control={control}
            render={({ field }) => (
              <PermissionsEditor
                value={field.value ?? []}
                onChange={field.onChange}
                catalog={catalog}
                placeholder="soul.list, soul.read, ..."
                ariaLabel="permissions роли"
              />
            )}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Можно оставить пустым — добавите потом через Role permissions.
          </span>
        </label>
        {serverError ? <div className={styles.errorBox} style={{ marginTop: 12 }} role="alert">{serverError}</div> : null}
      </form>
    </Modal>
  );
}
