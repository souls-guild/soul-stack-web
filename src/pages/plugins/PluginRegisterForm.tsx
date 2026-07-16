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

// kebab-case; the same pattern appears in openapi for plugin namespace/name.
const KEBAB_RE = /^[a-z][a-z0-9-]*$/;
// Tag-ref like v1.2.3 (a single path segment — a branch-ref with a slash the
// server will reject with 422; see /v1/plugins/sigils/{namespace}/{name}/{ref} description).
const TAG_REF_RE = /^[A-Za-z0-9._-]+$/;

// Messages — i18n keys under namespace `admin`; rendered via t(fieldError.message).
const schema = z.object({
  namespace: z
    .string()
    .trim()
    .min(1, 'admin:pluginErrRequired')
    .regex(KEBAB_RE, 'admin:pluginErrKebab'),
  name: z
    .string()
    .trim()
    .min(1, 'admin:pluginErrRequired')
    .regex(KEBAB_RE, 'admin:pluginErrKebab'),
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
    defaultValues: { namespace: '', name: '', ref: '' },
  });

  const allowMut = useMutation({
    mutationFn: (body: FormValues) => keeperApi.plugins.sigils.allow(body),
    onSuccess: (data, vars) => {
      setReply(data);
      setServerError(null);
      qc.invalidateQueries({ queryKey: ['plugins.sigils.list'] });
      // Don't leave the page right away — the operator should see the computed sha256.
      // The "To entry" button navigates to detail after the fact-check.
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
          <Link to="/plugins">plugins</Link> / <span>register</span>
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
            label="Namespace"
            placeholder={t('admin:pluginNamespacePlaceholder')}
            mono
            hint={t('admin:pluginNamespaceHint')}
            error={errors.namespace?.message ? t(errors.namespace.message) : undefined}
            {...register('namespace')}
          />
          <Input
            label="Name"
            placeholder={t('admin:pluginNamePlaceholderAcme')}
            mono
            hint={t('admin:pluginNameHint')}
            error={errors.name?.message ? t(errors.name.message) : undefined}
            {...register('name')}
          />
          <Input
            label="Ref"
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
          aria-label="результат допуска"
          style={{
            background: 'color-mix(in srgb, var(--ok, #2e7d32) 6%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--ok, #2e7d32) 30%, var(--border))',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--s-4)',
          }}
        >
          <h2 className={styles.sectionTitle}>{t('admin:pluginAllowedTitle')}</h2>
          <div className={styles.meta}>
            <span className={styles.metaKey}>Namespace</span>
            <span className={styles.metaVal}>{reply.namespace}</span>
            <span className={styles.metaKey}>Name</span>
            <span className={styles.metaVal}>{reply.name}</span>
            <span className={styles.metaKey}>Ref</span>
            <span className={styles.metaVal}>{reply.ref}</span>
            <span className={styles.metaKey}>SHA-256 (Keeper-side)</span>
            <span className={styles.metaVal}>{reply.sha256}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="primary"
              onClick={() =>
                navigate(
                  `/plugins/${encodeURIComponent(reply.namespace)}/${encodeURIComponent(reply.name)}/${encodeURIComponent(reply.ref)}`,
                )
              }
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
