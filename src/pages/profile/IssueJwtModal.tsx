// Issue a personal token to yourself: POST /v1/me/jwts -> 201 IssueTokenReply.
// The token is shown once. Lifetimes above the caller's ceiling
// (personal_ttl_max_seconds — ttl_max, or the OIDC sign-in lifetime) are not
// offered; the server refuses them anyway (422).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { keeperApi, type IssueTokenReply } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Button, Input, Modal } from '../../components/primitives';
import { durationSeconds, issueJwtSchema, PRESETS, type IssueJwtInput } from './schemas';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  ttlMaxSeconds: number;
  // Set for an OIDC sign-in: a token issued now expires then at the latest.
  expiresBy?: string;
  onClose: () => void;
  invalidateKeys: readonly (readonly unknown[])[];
}

function defaultPreset(ttlMaxSeconds: number): IssueJwtInput['preset'] {
  const fits = PRESETS.filter((p) => durationSeconds(p) <= ttlMaxSeconds);
  if (fits.includes('30d')) return '30d';
  return fits.length > 0 ? fits[fits.length - 1] : 'custom';
}

export function IssueJwtModal({ open, ttlMaxSeconds, expiresBy, onClose, invalidateKeys }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [issued, setIssued] = useState<IssueTokenReply | null>(null);
  const [copied, setCopied] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors },
  } = useForm<IssueJwtInput>({
    resolver: zodResolver(issueJwtSchema),
    values: { label: '', preset: defaultPreset(ttlMaxSeconds), custom: '' },
  });
  const preset = watch('preset');

  const mu = useMutation({
    mutationFn: (v: IssueJwtInput) =>
      keeperApi.me.jwts.issue({ label: v.label || undefined, ttl: v.preset === 'custom' ? v.custom : v.preset }),
    onSuccess: (reply) => {
      setIssued(reply);
      setServerError(null);
      for (const k of invalidateKeys) qc.invalidateQueries({ queryKey: [...k] });
    },
    onError: (err) => {
      setServerError(err instanceof ApiError ? t('errors:generic', { status: err.status, detail: err.message }) : String(err));
    },
  });

  function close() {
    setIssued(null);
    setCopied(false);
    setServerError(null);
    reset();
    onClose();
  }

  function onSubmit(v: IssueJwtInput) {
    const ttl = v.preset === 'custom' ? v.custom : v.preset;
    if (durationSeconds(ttl) > ttlMaxSeconds) {
      setError(v.preset === 'custom' ? 'custom' : 'preset', { message: 'profile:ttlAboveMax' });
      return;
    }
    mu.mutate(v);
  }

  if (issued) {
    return (
      <Modal
        open={open}
        title={t('profile:issuedTitle')}
        onClose={close}
        footer={
          <Button type="button" variant="primary" onClick={close} data-testid="issued-done">
            {t('profile:done')}
          </Button>
        }
      >
        <div
          role="alert"
          style={{
            padding: 'var(--s-3) var(--s-4)',
            background: 'color-mix(in srgb, var(--warning) 8%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--warning) 30%, var(--border))',
            borderRadius: 'var(--radius)',
            fontSize: 12.5,
            marginBottom: 12,
          }}
        >
          {t('profile:issuedWarn')}
        </div>
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <code className="mono" data-testid="issued-jwt" style={{ fontSize: 12, wordBreak: 'break-all', flex: 1 }}>
            {issued.jwt}
          </code>
          <Button
            type="button"
            aria-label={t('profile:copyTokenAria')}
            onClick={() => {
              if (navigator?.clipboard?.writeText) {
                void navigator.clipboard.writeText(issued.jwt);
                setCopied(true);
              }
            }}
          >
            <Copy size={14} /> {copied ? t('profile:copied') : t('copy')}
          </Button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
          jwt_id <span className="mono">{issued.jwt_id}</span> · {t('profile:expiresAt', { at: issued.expires_at.slice(0, 16).replace('T', ' ') })}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title={t('profile:issueTitle')}
      onClose={close}
      footer={
        <>
          <Button type="button" onClick={close}>
            {t('cancel')}
          </Button>
          <Button type="submit" form="issue-jwt-form" variant="primary" disabled={mu.isPending} data-testid="issue-jwt-submit">
            {t('profile:issue')}
          </Button>
        </>
      }
    >
      <form id="issue-jwt-form" onSubmit={handleSubmit(onSubmit)} className={styles.formFields}>
        <Input
          label={t('profile:fieldLabel')}
          hint={t('profile:fieldLabelHint')}
          placeholder={t('profile:fieldLabelPlaceholder')}
          data-testid="issue-jwt-label"
          error={errors.label?.message ? t(errors.label.message) : undefined}
          {...register('label')}
        />
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{t('profile:fieldTTL')}</legend>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {PRESETS.map((p) => {
              const over = durationSeconds(p) > ttlMaxSeconds;
              return (
                <label key={p} style={{ fontSize: 13, opacity: over ? 0.45 : 1 }}>
                  <input type="radio" value={p} disabled={over} data-testid={`issue-jwt-preset-${p}`} {...register('preset')} />{' '}
                  {t(`profile:preset_${p}`)}
                </label>
              );
            })}
            <label style={{ fontSize: 13 }}>
              <input type="radio" value="custom" data-testid="issue-jwt-preset-custom" {...register('preset')} /> {t('profile:presetCustom')}
            </label>
          </div>
          {preset === 'custom' ? (
            <div style={{ marginTop: 8 }}>
              <Input
                mono
                placeholder="45d"
                data-testid="issue-jwt-custom"
                aria-label={t('profile:presetCustom')}
                error={errors.custom?.message ? t(errors.custom.message, { max: humanSeconds(ttlMaxSeconds) }) : undefined}
                {...register('custom')}
              />
            </div>
          ) : null}
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }} data-testid="issue-jwt-ceiling">
            {t('profile:ttlCeiling', { max: humanSeconds(ttlMaxSeconds) })}
          </div>
          {expiresBy ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }} data-testid="issue-jwt-expires-by">
              {t('profile:expiresWithSignIn', { at: expiresBy.slice(0, 16).replace('T', ' ') })}
            </div>
          ) : null}
          {errors.preset?.message ? (
            <div className={styles.errorBox}>{t(errors.preset.message, { max: humanSeconds(ttlMaxSeconds) })}</div>
          ) : null}
        </fieldset>
        {serverError ? (
          <div className={styles.errorBox} role="alert">
            {serverError}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

function humanSeconds(s: number): string {
  if (s > 0 && s % 86400 === 0) return `${s / 86400}d`;
  if (s > 0 && s % 3600 === 0) return `${s / 3600}h`;
  return `${Math.floor(s / 60)}m`;
}
