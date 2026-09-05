import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Stamp } from 'lucide-react';
import { keeperApi, type PluginSigilAllowReply } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Button, Input } from '../../components/primitives';
import styles from '../common.module.css';

// kebab-case; the openapi pattern for the registration alias.
const KEBAB_RE = /^[a-z][a-z0-9-]*$/;
// Tag-ref like v1.2.3 (a single path segment — a branch-ref with a slash the
// server will reject with 422; see PluginSigilAllowRequest.ref).
const TAG_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// Messages — i18n keys under namespace `admin`; rendered via t(fieldError.message).
const schema = z.object({
  alias: z
    .string()
    .trim()
    .min(1, 'admin:pluginErrRequired')
    .regex(KEBAB_RE, 'admin:pluginErrKebab'),
  // The git remote the module repository is fetched from. Not pattern-checked
  // here: the keeper resolves it and answers 404 when it cannot, which is a
  // better error than a regex guess at what a valid remote looks like.
  source: z
    .string()
    .trim()
    .min(1, 'admin:pluginErrRequired')
    .max(2048, 'admin:pluginErrSourceTooLong'),
  ref: z
    .string()
    .trim()
    .min(1, 'admin:pluginErrRequired')
    .regex(TAG_REF_RE, 'admin:pluginErrTagRef'),
});

type FormValues = z.infer<typeof schema>;

export function PluginRegisterForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [reply, setReply] = useState<PluginSigilAllowReply | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { alias: '', source: '', ref: '' },
  });

  const allowMut = useMutation({
    mutationFn: (body: FormValues) => keeperApi.plugins.sigils.allow(body),
    onSuccess: (data, vars) => {
      setReply(data);
      setServerError(null);
      qc.invalidateQueries({ queryKey: ['plugins.sigils.list'] });
      // Don't leave the page right away — the operator should see the per-artifact
      // digests the keeper computed. The "To entry" button navigates after that check.
      void vars;
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.status === 422) {
          setServerError(`${t('admin:pluginErrValidation')} ${err.detail || err.message}`);
        } else if (err.status === 404) {
          setServerError(`${t('admin:pluginErrNotFound')} ${err.detail ?? ''}`);
        } else if (err.status === 409) {
          setServerError(`${t('admin:pluginErrConflict')} ${err.detail ?? ''}`);
        } else {
          setServerError(t('errors:generic', { status: err.status, detail: err.message }));
        }
      } else {
        setServerError(String(err));
      }
    },
  });

  function onSubmit(values: FormValues) {
    setReply(null);
    setServerError(null);
    allowMut.mutate(values);
  }

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.crumbs}>
          <Link to="/plugins">plugins</Link> / <span>{t('crumbRegister')}</span>
        </div>
        <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Stamp size={22} /> {t('admin:pluginRegisterTitle')}
        </h1>
        <div className={styles.crumbs}>
          {t('admin:pluginRegisterCrumbs')}
        </div>
      </div>

      <form className={styles.section} onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className={styles.filters}>
          <Input
            label={t('admin:pluginFieldAlias')}
            placeholder={t('admin:pluginAliasPlaceholder')}
            mono
            hint={t('admin:pluginAliasHint')}
            error={errors.alias?.message ? t(errors.alias.message) : undefined}
            {...register('alias')}
          />
          <Input
            label={t('admin:pluginFieldSource')}
            placeholder={t('admin:pluginSourcePlaceholder')}
            mono
            hint={t('admin:pluginSourceHint')}
            error={errors.source?.message ? t(errors.source.message) : undefined}
            {...register('source')}
          />
          <Input
            label={t('admin:pluginFieldRef')}
            placeholder={t('admin:pluginRefPlaceholder')}
            mono
            hint={t('admin:pluginRefHint')}
            error={errors.ref?.message ? t(errors.ref.message) : undefined}
            {...register('ref')}
          />
          <div style={{ alignSelf: 'flex-end' }}>
            <Button type="submit" variant="primary" disabled={isSubmitting || allowMut.isPending}>
              {allowMut.isPending ? t('allowing') : t('allow')}
            </Button>
          </div>
        </div>
        {serverError ? <div className={styles.errorBox}>{serverError}</div> : null}
      </form>

      {reply ? (
        <section
          className={styles.section}
          aria-label={t('admin:pluginAdmissionResultAria')}
          style={{
            background: 'color-mix(in srgb, var(--ok, #2e7d32) 6%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--ok, #2e7d32) 30%, var(--border))',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--s-4)',
          }}
        >
          <h2 className={styles.sectionTitle}>{t('admin:pluginAllowedTitle')}</h2>
          <div className={styles.meta}>
            <span className={styles.metaKey}>{t('admin:pluginColAlias')}</span>
            <span className={styles.metaVal}>{reply.alias}</span>
            <span className={styles.metaKey}>{t('admin:pluginColSource')}</span>
            <span className={styles.metaVal} style={{ wordBreak: 'break-all' }}>{reply.source}</span>
            <span className={styles.metaKey}>{t('common:colRef')}</span>
            <span className={styles.metaVal}>{reply.ref}</span>
            <span className={styles.metaKey}>{t('common:colKind')}</span>
            <span className={styles.metaVal}>{reply.kind}</span>
            <span className={styles.metaKey}>{t('common:colSha256Keeper')}</span>
            <span className={styles.metaVal} data-testid="plugin-allowed-digests">
              {(reply.artifacts ?? []).length === 0 ? (
                '—'
              ) : (
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {(reply.artifacts ?? []).map((a) => (
                    <span key={`${a.os}/${a.arch}/${a.path}`} className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                      {a.os}/{a.arch} — {a.sha256}
                    </span>
                  ))}
                </span>
              )}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="primary"
              onClick={() => navigate(`/plugins/${encodeURIComponent(reply.alias)}`)}
            >
              {t('admin:pluginGoToRecord')}
            </Button>
            <Button variant="ghost" onClick={() => navigate('/plugins')}>{t('admin:pluginGoToList')}</Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
