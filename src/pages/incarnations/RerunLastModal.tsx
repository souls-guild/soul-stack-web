import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import type { IncarnationRerunLastReply } from '../../api/keeper';
import { unlockSchema, type UnlockFormValues } from './schemas';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  incarnationName: string;
  onClose: () => void;
  /** Callback on successful launch: full reply (apply_id + rerun scenario). */
  onAccepted?: (reply: IncarnationRerunLastReply) => void;
}

// ErrRerunInputUnavailable — a separate problem type (not TypeIncarnationLocked).
const TYPE_RERUN_INPUT_UNAVAILABLE = 'https://soul-stack.io/errors/rerun-input-unavailable';

export function RerunLastModal({ open, incarnationName, onClose, onAccepted }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverDetail, setServerDetail] = useState<string | null>(null);

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
      keeperApi.incarnations.rerunLast(incarnationName, { reason: values.reason }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['incarnation', incarnationName] });
      reset();
      onAccepted?.(data);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setServerError(
          err.type === TYPE_RERUN_INPUT_UNAVAILABLE
            ? t('incarnations:rerunLastInputUnavailable')
            : t('incarnations:rerunLast409'),
        );
        setServerDetail(err.detail || null);
      } else {
        setServerError(
          err instanceof ApiError
            ? t('errors:generic', { status: err.status, detail: err.message })
            : String(err),
        );
      }
    },
  });

  function close() {
    setServerError(null);
    setServerDetail(null);
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      title={t('incarnations:rerunLastTitle', { name: incarnationName })}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={isSubmitting || mu.isPending} data-testid="rerun-cancel">
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={isSubmitting || mu.isPending}
            onClick={handleSubmit((v) => { setServerError(null); setServerDetail(null); mu.mutate(v); })}
            data-testid="rerun-submit"
          >
            {mu.isPending ? t('loading') : t('incarnations:rerunLastBtn')}
          </Button>
        </>
      }
    >
      <form noValidate>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          {t('incarnations:rerunLastDesc')}
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13 }}>{t('incarnations:reasonLabel')}</span>
          <textarea
            rows={4}
            placeholder={t('incarnations:rerunLastReasonPlaceholder')}
            spellCheck={false}
            data-testid="rerun-reason-input"
            aria-invalid={errors.reason ? 'true' : undefined}
            // maxLength synced with backend incarnation.ReasonMaxLen=500
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
            <span style={{ color: 'var(--danger)', fontSize: 12 }}>
              {t(errors.reason.message ?? '')}
            </span>
          ) : null}
        </label>
        {serverError ? (
          <div className={styles.errorBox} style={{ marginTop: 12 }} data-testid="rerun-error">
            {serverError}
            {serverDetail ? (
              <div style={{ marginTop: 4, fontSize: 11, opacity: 0.75 }}>
                {t('incarnations:rerunLast409Detail', { detail: serverDetail })}
              </div>
            ) : null}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
