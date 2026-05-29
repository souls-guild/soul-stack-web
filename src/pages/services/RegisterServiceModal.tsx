import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Modal } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { serviceRegisterSchema, type ServiceRegisterFormValues } from './schemas';
import { prettyServiceError } from './errors';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function RegisterServiceModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isValid, isSubmitting },
  } = useForm<ServiceRegisterFormValues>({
    resolver: zodResolver(serviceRegisterSchema),
    mode: 'onChange',
    defaultValues: { name: '', git: '', ref: 'main', refresh: '' },
  });

  const mu = useMutation({
    mutationFn: (values: ServiceRegisterFormValues) =>
      keeperApi.services.register({
        name: values.name.trim(),
        git: values.git.trim(),
        ref: values.ref.trim(),
        // refresh опционален — пустую строку не отправляем (openapi: опущено = без авто-refresh).
        ...(values.refresh.trim() ? { refresh: values.refresh.trim() } : {}),
      }),
    onSuccess: (view) => {
      qc.invalidateQueries({ queryKey: ['services.list'] });
      reset();
      onClose();
      navigate(`/services/${encodeURIComponent(view.name)}`);
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
      title={t('registerService')}
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
            {mu.isPending ? t('registering') : t('register')}
          </Button>
        </>
      }
    >
      <form noValidate>
        <Input
          label="Name"
          mono
          placeholder={t('admin:svcNamePlaceholderRedis')}
          hint={t('admin:svcNameHint')}
          error={errors.name?.message ? t(errors.name.message) : undefined}
          {...register('name')}
        />
        <div style={{ height: 12 }} />
        <Input
          label="Git"
          mono
          placeholder={t('admin:svcGitPlaceholder')}
          hint={t('admin:svcGitHint')}
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
          hint={t('admin:svcRefreshHint')}
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
