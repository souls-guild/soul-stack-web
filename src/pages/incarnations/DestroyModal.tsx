import { useMemo, useState } from 'react';
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
      setServerError(err instanceof ApiError ? `Ошибка ${err.status}: ${err.message}` : String(err));
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
      title={`Destroy: ${incarnationName}`}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={isSubmitting || mu.isPending}>
            Отмена
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={isSubmitting || mu.isPending || Boolean(applyId)}
            onClick={handleSubmit((v) => { setServerError(null); mu.mutate(v); })}
          >
            {mu.isPending ? 'Удаляем…' : 'Destroy'}
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
        Действие необратимо. Async-операция: incarnation переходит в <code className="mono">destroying</code>.
      </div>

      <Input
        label={`Напечатайте "${incarnationName}" для подтверждения`}
        mono
        aria-invalid={errors.confirmName ? 'true' : undefined}
        error={errors.confirmName?.message}
        {...register('confirmName')}
      />

      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, fontSize: 13 }}>
        <input
          type="checkbox"
          {...register('allowDestroy')}
          style={{ width: 16, height: 16, marginTop: 2, accentColor: 'var(--danger)' }}
        />
        <span>
          <strong style={{ color: 'var(--danger)' }}>allow_destroy</strong> — снос без teardown-scenario
          (force, DELETE строки напрямую). Без флага идёт штатный destroy через scenario{' '}
          <code className="mono">destroy</code>.
        </span>
      </label>

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
          Destroy принят. apply_id: <span className="mono">{applyId}</span>
        </div>
      ) : null}
      {serverError ? <div className={styles.errorBox} style={{ marginTop: 12 }}>{serverError}</div> : null}
    </Modal>
  );
}
