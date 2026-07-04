import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input, Modal } from '../../components/primitives';
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
    watch,
    formState: { errors, isSubmitting },
  } = useForm<UpgradeFormValues>({
    resolver: zodResolver(upgradeSchema),
    defaultValues: { to_version: '' },
  });

  // Превью перехода (NIM-34): при выбранной цели тянем upgrade-paths.
  // Graceful degradation — на любой ошибке (404/501/network) панель скрыта,
  // модалка работает как раньше; сам apply валидируется на POST upgrade.
  const toVersion = watch('to_version');
  const preview = useQuery({
    queryKey: ['incarnation.upgradePaths', incarnationName, toVersion],
    queryFn: () => keeperApi.incarnations.upgradePaths(incarnationName, toVersion),
    enabled: open && Boolean(toVersion),
    retry: false,
  });
  const target = preview.data?.target;
  const migrations = target?.state_migrations ?? [];
  // reachable=false приходит валидным 200 (структурно битая цепочка) — блокируем submit.
  const blocked = Boolean(target) && target!.reachable === false;

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
              data-testid="upgrade-submit"
              disabled={isSubmitting || mu.isPending || blocked}
              title={blocked ? t('incarnations:upgradeUnreachableSubmit') : undefined}
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
      {!applyId && toVersion ? (
        <div data-testid="upgrade-preview" style={{ marginTop: 12 }}>
          {preview.isLoading ? (
            <div
              data-testid="upgrade-preview-loading"
              style={{ fontSize: 12, color: 'var(--text-muted)' }}
            >
              {t('incarnations:upgradePreviewLoading')}
            </div>
          ) : preview.error || !target ? null : (
            <div
              style={{
                padding: 12,
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('incarnations:upgradeDirectionLabel')}:
                </span>
                <span data-testid="upgrade-direction" className="mono" style={{ fontSize: 12 }}>
                  {target.direction}
                </span>
                {target.mode ? (
                  <Badge tone={target.mode === 'found' ? 'ok' : 'muted'}>
                    <span data-testid="upgrade-mode-badge">{target.mode}</span>
                  </Badge>
                ) : null}
              </div>
              {target.mode ? (
                <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '6px 0 0' }}>
                  {target.mode === 'found'
                    ? t('incarnations:upgradeModeFoundHint')
                    : t('incarnations:upgradeModeLegacyHint')}
                </p>
              ) : null}
              <p
                data-testid="upgrade-migrations"
                style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}
              >
                {migrations.length > 0
                  ? `${t('incarnations:upgradeMigrationsLabel')}: ${migrations
                      .map((m) => `${m.from}→${m.to}`)
                      .join(', ')}`
                  : t('incarnations:upgradeMigrationsNone')}
              </p>
              {blocked ? (
                <div
                  data-testid="upgrade-unreachable"
                  style={{
                    marginTop: 10,
                    padding: 10,
                    background: 'color-mix(in srgb, var(--danger) 8%, var(--surface))',
                    border: '1px solid color-mix(in srgb, var(--danger) 40%, var(--border))',
                    borderRadius: 'var(--radius)',
                    fontSize: 12,
                    color: 'var(--danger)',
                  }}
                >
                  <strong>{t('incarnations:upgradeUnreachableLabel')}:</strong>{' '}
                  {target.unreachable_reason ?? t('incarnations:upgradeUnreachableSubmit')}
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
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
