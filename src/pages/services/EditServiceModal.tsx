import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal } from '../../components/primitives';
import { keeperApi, type ServiceView } from '../../api/keeper';
import { serviceEditSchema, type ServiceEditFormValues } from './schemas';
import { prettyServiceError } from './errors';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  service: ServiceView;
}

// PATCH /v1/services/{name} — replace-семантика mutable-полей (git/ref/refresh);
// name — ключ записи, не меняется.
export function EditServiceModal({ open, onClose, service }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isValid, isSubmitting },
  } = useForm<ServiceEditFormValues>({
    resolver: zodResolver(serviceEditSchema),
    mode: 'onChange',
    defaultValues: { git: service.git, ref: service.ref, refresh: service.refresh ?? '' },
  });

  const mu = useMutation({
    mutationFn: (values: ServiceEditFormValues) =>
      keeperApi.services.update(service.name, {
        git: values.git.trim(),
        ref: values.ref.trim(),
        ...(values.refresh.trim() ? { refresh: values.refresh.trim() } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service', service.name] });
      qc.invalidateQueries({ queryKey: ['services.list'] });
      onClose();
    },
    onError: (err) => setServerError(prettyServiceError(err)),
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
      title={t('forms:editServiceTitle', { name: service.name })}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={isSubmitting || mu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!isValid || isSubmitting || mu.isPending}
            onClick={handleSubmit((v) => {
              setServerError(null);
              mu.mutate(v);
            })}
          >
            {mu.isPending ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <form noValidate>
        <Input
          label="Git"
          mono
          placeholder={t('admin:svcGitPlaceholder')}
          hint={t('admin:svcGitHintShort')}
          error={errors.git?.message ? t(errors.git.message) : undefined}
          {...register('git')}
        />
        <div style={{ height: 12 }} />
        <Input
          label="Ref"
          mono
          placeholder={t('admin:svcRefPlaceholderMain')}
          hint={t('admin:svcRefHint')}
          error={errors.ref?.message ? t(errors.ref.message) : undefined}
          {...register('ref')}
        />
        <div style={{ height: 12 }} />
        <Input
          label="Refresh"
          mono
          placeholder={t('admin:svcRefreshPlaceholder')}
          hint={t('admin:svcRefreshHintShort')}
          error={errors.refresh?.message ? t(errors.refresh.message) : undefined}
          {...register('refresh')}
        />
        {serverError ? (
          <div className={styles.errorBox} style={{ marginTop: 12 }} role="alert">
            {serverError}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
