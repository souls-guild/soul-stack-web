import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { upgradeSchema, type UpgradeFormValues } from './schemas';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  incarnationName: string;
  currentRef: string;
  onClose: () => void;
}

export function UpgradeModal({ open, incarnationName, currentRef, onClose }: Props) {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [applyId, setApplyId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UpgradeFormValues>({
    resolver: zodResolver(upgradeSchema),
    defaultValues: { to_version: '' },
  });

  const mu = useMutation({
    mutationFn: (values: UpgradeFormValues) =>
      keeperApi.incarnations.upgrade(incarnationName, { to_version: values.to_version }),
    onSuccess: (reply) => {
      setApplyId(reply.apply_id);
      qc.invalidateQueries({ queryKey: ['incarnation', incarnationName] });
    },
    onError: (err) => {
      setServerError(err instanceof ApiError ? `Ошибка ${err.status}: ${err.message}` : String(err));
    },
  });

  function close() {
    setServerError(null);
    setApplyId(null);
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      title={`Upgrade: ${incarnationName}`}
      onClose={close}
      footer={
        applyId ? (
          <Button type="button" variant="primary" onClick={close}>
            Закрыть
          </Button>
        ) : (
          <>
            <Button type="button" variant="ghost" onClick={close} disabled={isSubmitting || mu.isPending}>
              Отмена
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={isSubmitting || mu.isPending}
              onClick={handleSubmit((v) => { setServerError(null); mu.mutate(v); })}
            >
              {mu.isPending ? 'Запускаем…' : 'Upgrade'}
            </Button>
          </>
        )
      }
    >
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
        Запускает миграцию state (ADR-019) + переключает service_version одной PG-транзакцией.
        Текущая привязка: <span className="mono">{currentRef}</span>.
      </p>
      <Input
        label="To version (git-ref)"
        placeholder="v3.0.0 / main / abcdef0"
        mono
        aria-invalid={errors.to_version ? 'true' : undefined}
        error={errors.to_version?.message}
        {...register('to_version')}
      />
      {applyId ? (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: 'color-mix(in srgb, var(--ok) 8%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--ok) 30%, var(--border))',
            borderRadius: 'var(--radius)',
            fontSize: 13,
          }}
        >
          Upgrade принят. apply_id: <span className="mono">{applyId}</span>
        </div>
      ) : null}
      {serverError ? <div className={styles.errorBox} style={{ marginTop: 12 }}>{serverError}</div> : null}
    </Modal>
  );
}
