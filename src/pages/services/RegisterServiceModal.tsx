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
          placeholder="redis"
          hint="kebab-case: имя сервиса в реестре"
          error={errors.name?.message}
          {...register('name')}
        />
        <div style={{ height: 12 }} />
        <Input
          label="Git"
          mono
          placeholder="https://git.example.com/service-redis.git"
          hint="git-источник service-репо (http(s):// / git:// / ssh / file://)"
          error={errors.git?.message}
          {...register('git')}
        />
        <div style={{ height: 12 }} />
        <Input
          label="Ref"
          mono
          placeholder="main"
          hint="git tag или branch — версия сервиса"
          error={errors.ref?.message}
          {...register('ref')}
        />
        <div style={{ height: 12 }} />
        <Input
          label="Refresh"
          mono
          placeholder="5m"
          hint="опц. авто-refresh git-репо; пусто — без авто-refresh"
          error={errors.refresh?.message}
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
