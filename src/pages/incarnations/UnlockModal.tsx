import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { unlockSchema, type UnlockFormValues } from './schemas';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  incarnationName: string;
  onClose: () => void;
}

export function UnlockModal({ open, incarnationName, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UnlockFormValues>({
    resolver: zodResolver(unlockSchema),
    defaultValues: { reason: '' },
  });

  const mu = useMutation({
    mutationFn: (values: UnlockFormValues) =>
      keeperApi.incarnations.unlock(incarnationName, { reason: values.reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incarnation', incarnationName] });
      reset();
      onClose();
    },
    onError: (err) => {
      setServerError(err instanceof ApiError ? t('errors:generic', { status: err.status, detail: err.message }) : String(err));
    },
  });

  function close() {
    setServerError(null);
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      title={t('forms:unlockTitle', { name: incarnationName })}
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
            {mu.isPending ? t('unlocking') : t('unlock')}
          </Button>
        </>
      }
    >
      <form noValidate>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          {t('incarnations:unlockDesc')}
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13 }}>{t('incarnations:reasonLabel')}</span>
          <textarea
            rows={4}
            placeholder={t('incarnations:unlockReasonPlaceholder')}
            spellCheck={false}
            aria-invalid={errors.reason ? 'true' : undefined}
            // maxLength синхронизирован с backend incarnation.ReasonMaxLen=500
            maxLength={500}
            {...register('reason')}
            style={{
              padding: 10,
              borderRadius: 'var(--radius)',
              border: `1px solid ${errors.reason ? 'var(--danger)' : 'var(--border)'}`,
              background: 'var(--surface)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12.5,
              resize: 'vertical',
            }}
          />
          {errors.reason ? (
            <span style={{ color: 'var(--danger)', fontSize: 12 }}>{t(errors.reason.message ?? '')}</span>
          ) : null}
        </label>
        {serverError ? <div className={styles.errorBox} style={{ marginTop: 12 }}>{serverError}</div> : null}
      </form>
    </Modal>
  );
}
