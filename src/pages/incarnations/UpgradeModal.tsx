import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { useServiceRefs } from '../services/refs';
import { upgradeSchema, type UpgradeFormValues } from './schemas';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  incarnationName: string;
  serviceName: string;
  currentRef: string;
  onClose: () => void;
}

export function UpgradeModal({ open, incarnationName, serviceName, currentRef, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [applyId, setApplyId] = useState<string | null>(null);

  // Тянем refs только когда modal открыт — не плодим лишних запросов.
  const refs = useServiceRefs(serviceName, open);

  const {
    register,
    handleSubmit,
    reset,
    control,
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
      setServerError(err instanceof ApiError ? t('errors:generic', { status: err.status, detail: err.message }) : String(err));
    },
  });

  function close() {
    setServerError(null);
    setApplyId(null);
    reset();
    onClose();
  }

  const useDropdown =
    !refs.unavailable && (refs.tags.length > 0 || refs.branches.length > 0);

  return (
    <Modal
      open={open}
      title={t('forms:upgradeTitle', { name: incarnationName })}
      onClose={close}
      footer={
        applyId ? (
          <Button type="button" variant="primary" onClick={close}>
            {t('close')}
          </Button>
        ) : (
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
              {mu.isPending ? t('running') : t('upgrade')}
            </Button>
          </>
        )
      }
    >
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
        {t('incarnations:upgradeDesc')} <span className="mono">{currentRef}</span>.
      </p>
      {useDropdown ? (
        <Controller
          control={control}
          name="to_version"
          render={({ field }) => (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>To version (git-ref)</span>
              <select
                value={field.value}
                onChange={(e) => field.onChange(e.target.value)}
                onBlur={field.onBlur}
                disabled={refs.loading}
                aria-invalid={errors.to_version ? 'true' : undefined}
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius)',
                  border: `1px solid ${errors.to_version ? 'var(--danger)' : 'var(--border)'}`,
                  background: 'var(--surface)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                }}
              >
                <option value="">{t('incarnations:selectRef')}</option>
                {refs.tags.length > 0 ? (
                  <optgroup label="tags">
                    {refs.tags.map((r) => (
                      <option key={`tag/${r.name}`} value={r.name}>
                        {r.name}
                        {r.is_default ? ' (default)' : ''}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {refs.branches.length > 0 ? (
                  <optgroup label="branches">
                    {refs.branches.map((r) => (
                      <option key={`branch/${r.name}`} value={r.name}>
                        {r.name}
                        {r.is_default ? ' (default)' : ''}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              {errors.to_version ? (
                <span style={{ color: 'var(--danger)', fontSize: 12 }}>
                  {t(errors.to_version.message ?? '')}
                </span>
              ) : (
                <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                  {t('incarnations:refsManual', { name: serviceName })}
                </span>
              )}
            </label>
          )}
        />
      ) : (
        <Input
          label="To version (git-ref)"
          placeholder="v3.0.0 / main / abcdef0"
          mono
          aria-invalid={errors.to_version ? 'true' : undefined}
          error={errors.to_version ? t(errors.to_version.message ?? '') : undefined}
          hint={
            refs.loading
              ? t('forms:refsLoading')
              : refs.unavailable
                ? t('forms:refsUnavailable')
                : refs.error ?? undefined
          }
          {...register('to_version')}
        />
      )}
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
          {t('incarnations:upgradeAccepted')} <span className="mono">{applyId}</span>
        </div>
      ) : null}
      {serverError ? <div className={styles.errorBox} style={{ marginTop: 12 }}>{serverError}</div> : null}
    </Modal>
  );
}
