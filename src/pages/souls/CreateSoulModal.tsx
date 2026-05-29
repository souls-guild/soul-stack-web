import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, ServerIcon } from 'lucide-react';
import { Button, Modal } from '../../components/primitives';
import { keeperApi, type SoulCreateReply, type SoulTransport } from '../../api/keeper';
import { ApiError } from '../../api/client';
import i18n from '../../i18n';
import styles from '../common.module.css';

// SID: FQDN-like — строчные буквы/цифры, точки, дефисы. Не хардкодим валидацию
// hostname-правил RFC, следуем спеке SoulCreateRequest (docs/soul/identity.md).
const SID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,253}$/;

const COVEN_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function parseCovens(raw: string): { valid: string[]; invalid: string[] } {
  const tokens = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const t of tokens) {
    if (COVEN_PATTERN.test(t)) valid.push(t);
    else invalid.push(t);
  }
  return { valid, invalid };
}

function prettyError(err: unknown): string {
  const t = i18n.t.bind(i18n);
  if (err instanceof ApiError) {
    if (err.status === 409) return t('souls:createErrorConflict');
    if (err.status === 422) return t('souls:createErrorInvalidSid');
    if (err.status === 403) return t('errors:forbidden');
    return t('errors:generic', { status: err.status, detail: err.detail || err.message });
  }
  return String(err);
}

interface Props {
  open: boolean;
  onClose: () => void;
}

// Компонент success-state: показывает bootstrap_token один раз (для transport=agent)
// или подтверждение регистрации (transport=ssh). Токен не логируется.
function SuccessView({
  reply,
  onClose,
}: {
  reply: SoulCreateReply;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  function doCopy() {
    if (!reply.bootstrap_token) return;
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(reply.bootstrap_token);
      setCopied(true);
    }
  }

  return (
    <Modal
      open
      title={t('souls:createSuccessTitle', { sid: reply.sid })}
      onClose={onClose}
      footer={
        <Button type="button" variant="primary" onClick={onClose}>
          {t('souls:done')}
        </Button>
      }
    >
      <div className={styles.meta}>
        <span className={styles.metaKey}>SID</span>
        <span className={styles.metaVal}>{reply.sid}</span>
        <span className={styles.metaKey}>transport</span>
        <span className={styles.metaVal}>{reply.transport}</span>
        <span className={styles.metaKey}>status</span>
        <span className={styles.metaVal}>{reply.status}</span>
        {reply.covens && reply.covens.length > 0 ? (
          <>
            <span className={styles.metaKey}>covens</span>
            <span className={styles.metaVal}>{reply.covens.join(', ')}</span>
          </>
        ) : null}
      </div>

      {reply.bootstrap_token ? (
        <>
          <div
            style={{
              marginTop: 14,
              padding: 'var(--s-3) var(--s-4)',
              background: 'color-mix(in srgb, var(--warning) 10%, var(--surface))',
              border: '1px solid color-mix(in srgb, var(--warning) 30%, var(--border))',
              borderRadius: 'var(--radius)',
              color: 'var(--warning)',
              fontSize: 12.5,
            }}
          >
            {t('souls:createTokenWarn', { expires: reply.expires_at ?? '—' })}
          </div>
          <div
            style={{
              marginTop: 10,
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
              style={{ fontSize: 12, wordBreak: 'break-all', flex: 1 }}
            >
              {reply.bootstrap_token}
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
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            {t('souls:createOnboardingHint')}
          </p>
        </>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 12 }}>
          {t('souls:createSshRegistered')}
        </p>
      )}
    </Modal>
  );
}

export function CreateSoulModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [sid, setSid] = useState('');
  const [transport, setTransport] = useState<SoulTransport>('agent');
  const [covensRaw, setCovensRaw] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const [reply, setReply] = useState<SoulCreateReply | null>(null);

  const sidValid = SID_PATTERN.test(sid);
  const covens = parseCovens(covensRaw);

  const mu = useMutation({
    mutationFn: () =>
      keeperApi.souls.create({
        sid: sid.trim(),
        transport,
        covens: covens.valid.length > 0 ? covens.valid : undefined,
      }),
    onSuccess: (data) => {
      setReply(data);
      setServerError(null);
      void qc.invalidateQueries({ queryKey: ['souls'] });
    },
    onError: (err) => {
      setServerError(prettyError(err));
    },
  });

  function close() {
    setSid('');
    setTransport('agent');
    setCovensRaw('');
    setServerError(null);
    setReply(null);
    onClose();
  }

  if (reply) {
    return <SuccessView reply={reply} onClose={close} />;
  }

  const canSubmit = sid.trim().length > 0 && sidValid && covens.invalid.length === 0 && !mu.isPending;

  return (
    <Modal
      open={open}
      title={t('souls:createTitle')}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canSubmit}
            onClick={() => {
              setServerError(null);
              mu.mutate();
            }}
          >
            <ServerIcon size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />
            {mu.isPending ? t('souls:creating') : t('souls:createSubmit')}
          </Button>
        </>
      }
    >
      <form noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13 }}>
            SID <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>
          </span>
          <input
            type="text"
            value={sid}
            onChange={(e) => setSid(e.target.value)}
            placeholder={t('souls:createSidPlaceholder')}
            aria-label={t('souls:createSidAria')}
            aria-invalid={sid.length > 0 && !sidValid ? 'true' : undefined}
            autoFocus
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: `1px solid ${sid.length > 0 && !sidValid ? 'var(--danger)' : 'var(--border)'}`,
              background: 'var(--surface)',
              fontFamily: 'var(--font-mono)',
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('souls:createSidHint')}
          </span>
          {sid.length > 0 && !sidValid ? (
            <span style={{ fontSize: 12, color: 'var(--danger)' }}>
              {t('souls:createSidError')}
            </span>
          ) : null}
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13 }}>transport</span>
          <select
            value={transport}
            onChange={(e) => setTransport(e.target.value as SoulTransport)}
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
            }}
          >
            <option value="agent">agent</option>
            <option value="ssh">ssh</option>
          </select>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {transport === 'agent'
              ? t('souls:createTransportAgentHint')
              : t('souls:createTransportSshHint')}
          </span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13 }}>
            covens{' '}
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              ({t('forms:optional')})
            </span>
          </span>
          <input
            type="text"
            value={covensRaw}
            onChange={(e) => setCovensRaw(e.target.value)}
            placeholder={t('souls:covensPlaceholder')}
            aria-label={t('souls:createCovensAria')}
            aria-invalid={covens.invalid.length > 0 ? 'true' : undefined}
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: `1px solid ${covens.invalid.length > 0 ? 'var(--danger)' : 'var(--border)'}`,
              background: 'var(--surface)',
              fontFamily: 'var(--font-mono)',
            }}
          />
          {covens.invalid.length > 0 ? (
            <span style={{ fontSize: 12, color: 'var(--danger)' }}>
              {t('souls:covensInvalidLabels', { tokens: covens.invalid.join(', ') })}
            </span>
          ) : null}
        </label>

        {serverError ? (
          <div className={styles.errorBox} role="alert">
            {serverError}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
