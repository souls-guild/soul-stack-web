import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { Button, Modal } from '../../components/primitives';
import { keeperApi, type SoulIssueTokenReply } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { issueTokenSchema, type IssueTokenInput } from './schemas';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  sid: string;
  onClose: () => void;
}

// Issue Token для Soul (transport: agent). API:
//   - POST /v1/souls/{sid}/issue-token?force=<bool>
//   - 200 → SoulIssueTokenReply (plain bootstrap_token, отдаётся один раз);
//   - 409 → активный токен есть, нужен force=true (старый ревокируется);
//   - 422 → transport: ssh (модалка не должна открываться для ssh).
// Отдельного revoke-endpoint нет: revoke = re-issue с force=true. Это
// проговорено в UI рядом с чекбоксом.
//
// Замечание про ttl_seconds: openapi.yaml /v1/souls/{sid}/issue-token не
// принимает body — TTL берётся серверный по умолчанию (см. описание endpoint
// «TTL по умолчанию»). Поле формы сохраняем для UX, но запрос его не несёт;
// показываем пользователю как hint о серверном дефолте.
export function IssueTokenModal({ open, sid, onClose }: Props) {
  const { t } = useTranslation();
  const [serverError, setServerError] = useState<string | null>(null);
  const [issued, setIssued] = useState<SoulIssueTokenReply | null>(null);
  const [copied, setCopied] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
    watch,
  } = useForm<IssueTokenInput>({
    resolver: zodResolver(issueTokenSchema),
    defaultValues: { ttl_seconds: 3600, force: false },
  });

  const force = watch('force');

  const mu = useMutation({
    mutationFn: (values: IssueTokenInput) => keeperApi.souls.issueToken(sid, values.force),
    onSuccess: (reply) => {
      setIssued(reply);
      setServerError(null);
    },
    onError: (err) => {
      setServerError(err instanceof ApiError ? t('errors:generic', { status: err.status, detail: err.message }) : String(err));
    },
  });

  function close() {
    setServerError(null);
    setIssued(null);
    setCopied(false);
    reset({ ttl_seconds: 3600, force: false });
    onClose();
  }

  function doCopy() {
    if (!issued) return;
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(issued.bootstrap_token);
      setCopied(true);
    }
  }

  // Success state — показываем plain-токен и warning.
  if (issued) {
    return (
      <Modal
        open={open}
        title={t('souls:tokenIssuedTitle', { sid })}
        onClose={close}
        footer={
          <Button type="button" variant="primary" onClick={close}>
            {t('souls:done')}
          </Button>
        }
      >
        <div
          style={{
            padding: 'var(--s-3) var(--s-4)',
            background: 'color-mix(in srgb, var(--warning) 8%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--warning) 30%, var(--border))',
            borderRadius: 'var(--radius)',
            color: 'var(--warning)',
            fontSize: 12.5,
            marginBottom: 12,
          }}
        >
          {t('souls:tokenIssuedWarn')}
        </div>
        <div className={styles.meta}>
          <span className={styles.metaKey}>sid</span>
          <span className={styles.metaVal}>{issued.sid}</span>
          <span className={styles.metaKey}>expires_at</span>
          <span className={styles.metaVal}>{issued.expires_at}</span>
        </div>
        <div
          style={{
            marginTop: 12,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <code
            className="mono"
            style={{
              fontSize: 12,
              wordBreak: 'break-all',
              flex: 1,
            }}
          >
            {issued.bootstrap_token}
          </code>
          <button
            type="button"
            onClick={doCopy}
            aria-label={t('souls:copyTokenAria')}
            title={t('copy')}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '4px 8px',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            <Copy size={12} /> {copied ? t('copied') : t('copy')}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title={t('forms:issueTokenForSidTitle', { sid })}
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
            {mu.isPending ? t('issuing') : t('issue')}
          </Button>
        </>
      }
    >
      <form noValidate>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          {t('souls:issueTokenIntro')} <code className="mono">force=true</code>.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: 13 }}>{t('souls:ttlLabel')}</span>
          <input
            type="number"
            min={60}
            step={60}
            aria-invalid={errors.ttl_seconds ? 'true' : undefined}
            {...register('ttl_seconds', { valueAsNumber: true })}
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: `1px solid ${errors.ttl_seconds ? 'var(--danger)' : 'var(--border)'}`,
              background: 'var(--surface)',
              fontFamily: 'var(--font-mono)',
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('souls:ttlHint')}
          </span>
          {errors.ttl_seconds ? (
            <span style={{ color: 'var(--danger)', fontSize: 12 }}>{t(errors.ttl_seconds.message ?? '')}</span>
          ) : null}
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" {...register('force')} />
          <span>
            <code className="mono">force=true</code> {t('souls:forceHint')}
          </span>
        </label>
        {!force ? (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            {t('souls:forceWarn')}
          </div>
        ) : null}
        {serverError ? <div className={styles.errorBox} style={{ marginTop: 12 }}>{serverError}</div> : null}
      </form>
    </Modal>
  );
}
