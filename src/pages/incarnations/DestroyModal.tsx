import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Modal } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { makeDestroySchema, type DestroyFormValues } from './schemas';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  incarnationName: string;
  onClose: () => void;
}

export function DestroyModal({ open, incarnationName, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [applyId, setApplyId] = useState<string | null>(null);
  const schema = useMemo(() => makeDestroySchema(incarnationName), [incarnationName]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DestroyFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { confirmName: '', allowDestroy: false },
  });

  const mu = useMutation({
    mutationFn: (values: DestroyFormValues) =>
      keeperApi.incarnations.destroy(incarnationName, values.allowDestroy),
    onSuccess: (reply) => {
      setApplyId(reply.apply_id);
      qc.invalidateQueries({ queryKey: ['incarnation', incarnationName] });
      qc.invalidateQueries({ queryKey: ['incarnations'] });
      setTimeout(() => {
        reset();
        onClose();
        navigate('/incarnations');
      }, 800);
    },
    onError: (err) => {
      setServerError(err instanceof ApiError ? t('errors:generic', { status: err.status, detail: err.message }) : String(err));
    },
  });

  function close() {
    if (mu.isPending) return;
    setServerError(null);
    setApplyId(null);
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      title={t('forms:destroyTitle', { name: incarnationName })}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={isSubmitting || mu.isPending} data-testid="destroy-cancel">
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={isSubmitting || mu.isPending || Boolean(applyId)}
            onClick={handleSubmit((v) => { setServerError(null); mu.mutate(v); })}
            data-testid="destroy-submit"
          >
            {mu.isPending ? t('deleting') : t('destroy')}
          </Button>
        </>
      }
    >
      <div
        style={{
          padding: 12,
          background: 'color-mix(in srgb, var(--danger) 8%, var(--surface))',
          border: '1px solid color-mix(in srgb, var(--danger) 30%, var(--border))',
          borderRadius: 'var(--radius)',
          fontSize: 13,
          color: 'var(--danger)',
          marginBottom: 12,
        }}
      >
        {t('incarnations:destroyIrreversible')} <code className="mono">destroying</code>.
      </div>

      <Input
        label={t('incarnations:destroyConfirmLabel', { name: incarnationName })}
        mono
        data-testid="destroy-confirm-input"
        aria-invalid={errors.confirmName ? 'true' : undefined}
        error={errors.confirmName ? t(errors.confirmName.message ?? '', { name: incarnationName }) : undefined}
        {...register('confirmName')}
      />

      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, fontSize: 13 }}>
        <input
          type="checkbox"
          {...register('allowDestroy')}
          data-testid="destroy-allow-checkbox"
          style={{ width: 16, height: 16, marginTop: 2, accentColor: 'var(--danger)' }}
        />
        <span>
          <strong style={{ color: 'var(--danger)' }}>allow_destroy</strong> {t('incarnations:allowDestroyDesc')}{' '}
          <code className="mono">destroy</code>.
        </span>
      </label>

      {applyId ? (
        <div
          data-testid="destroy-accepted"
          style={{
            marginTop: 12,
            padding: 12,
            background: 'color-mix(in srgb, var(--ok) 8%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--ok) 30%, var(--border))',
            borderRadius: 'var(--radius)',
            fontSize: 13,
          }}
        >
          {t('incarnations:destroyAccepted')} <span className="mono">{applyId}</span>
        </div>
      ) : null}
      {serverError ? <div className={styles.errorBox} style={{ marginTop: 12 }} data-testid="destroy-error">{serverError}</div> : null}
    </Modal>
  );
}
