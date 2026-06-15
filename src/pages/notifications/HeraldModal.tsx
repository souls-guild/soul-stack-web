import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { keeperApi, type Herald, type HeraldCreateRequest, type HeraldUpdateRequest } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Modal, Button, Input } from '../../components/primitives';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Если передан — режим редактирования, иначе создание. */
  editing?: Herald;
}

/**
 * Парсит строку "Key: Value\nKey2: Value2" в объект.
 * Строки без ':' игнорируются.
 */
function parseHeaders(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) result[k] = v;
  }
  return result;
}

function serialiseHeaders(headers: Record<string, string> | undefined): string {
  if (!headers) return '';
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

function configFromForm(form: {
  url: string;
  headersRaw: string;
  httpAllowed: boolean;
  allowPrivate: boolean;
}): Record<string, unknown> {
  const cfg: Record<string, unknown> = { url: form.url };
  const headers = parseHeaders(form.headersRaw);
  if (Object.keys(headers).length > 0) cfg.headers = headers;
  if (form.httpAllowed) cfg.http_allowed = true;
  if (form.allowPrivate) cfg.allow_private = true;
  return cfg;
}

export function HeraldModal({ open, onClose, editing }: Props) {
  const { t } = useTranslation(['notifications', 'common']);
  const tc = (k: string) => t(`common:${k}`);
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [headersRaw, setHeadersRaw] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [httpAllowed, setHttpAllowed] = useState(false);
  const [allowPrivate, setAllowPrivate] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      const cfg = (editing.config ?? {}) as Record<string, unknown>;
      setUrl(typeof cfg.url === 'string' ? cfg.url : '');
      setHeadersRaw(serialiseHeaders(cfg.headers as Record<string, string> | undefined));
      setSecretRef(editing.secret_ref ?? '');
      setEnabled(editing.enabled);
      setHttpAllowed(Boolean(cfg.http_allowed));
      setAllowPrivate(Boolean(cfg.allow_private));
      setShowAdvanced(Boolean(cfg.http_allowed || cfg.allow_private));
    } else {
      setName('');
      setUrl('');
      setHeadersRaw('');
      setSecretRef('');
      setEnabled(true);
      setHttpAllowed(false);
      setAllowPrivate(false);
      setShowAdvanced(false);
    }
  }, [open, editing]);

  const createMu = useMutation({
    mutationFn: (body: HeraldCreateRequest) => keeperApi.heralds.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['heralds.list'] });
      onClose();
    },
  });

  const updateMu = useMutation({
    mutationFn: (body: HeraldUpdateRequest) => keeperApi.heralds.update(editing!.name, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['heralds.list'] });
      qc.invalidateQueries({ queryKey: ['herald.get', editing!.name] });
      onClose();
    },
  });

  const mu = editing ? updateMu : createMu;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // config в OpenAPI-схеме Herald — opaque object (type: object без properties).
    // openapi-typescript генерирует Record<string, never>; приводим через as-cast.
    const cfg = configFromForm({ url, headersRaw, httpAllowed, allowPrivate }) as Record<string, never>;
    if (editing) {
      const body: HeraldUpdateRequest = {
        type: 'webhook',
        config: cfg,
        secret_ref: secretRef || undefined,
        enabled,
      };
      updateMu.mutate(body);
    } else {
      const body: HeraldCreateRequest = {
        name,
        type: 'webhook',
        config: cfg,
        secret_ref: secretRef || undefined,
        enabled,
      };
      createMu.mutate(body);
    }
  }

  const isPending = mu.isPending;
  const error = mu.error;
  const title = editing ? t('heraldEditTitle') : t('heraldCreateTitle');

  return (
    <Modal open={open} title={title} onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!editing && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className={styles.metaKey}>{t('heraldFieldName')} *</span>
            <Input
              data-testid="herald-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-webhook"
              required
              pattern="^[a-z0-9-]{1,63}$"
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('heraldFieldNameHint')}</span>
          </label>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>{t('heraldFieldUrl')} *</span>
          <Input
            data-testid="herald-url-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hooks.example.com/notify"
            required
            type="url"
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>{t('heraldFieldSecretRef')}</span>
          <Input
            data-testid="herald-secret-ref-input"
            value={secretRef}
            onChange={(e) => setSecretRef(e.target.value)}
            placeholder="vault:secret/my-webhook-token"
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('heraldFieldSecretRefHint')}</span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>{t('heraldFieldHeaders')}</span>
          <textarea
            data-testid="herald-headers-input"
            value={headersRaw}
            onChange={(e) => setHeadersRaw(e.target.value)}
            placeholder="Authorization: Bearer token&#10;X-Custom-Header: value"
            rows={3}
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              resize: 'vertical',
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('heraldFieldHeadersHint')}</span>
        </label>

        <div>
          <button
            type="button"
            data-testid="herald-advanced-toggle"
            onClick={() => setShowAdvanced((v) => !v)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              cursor: 'pointer',
              fontSize: 12,
              padding: 0,
            }}
          >
            {showAdvanced ? '▾' : '▸'} {t('heraldAdvanced')}
          </button>
          {showAdvanced && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  data-testid="herald-http-allowed"
                  checked={httpAllowed}
                  onChange={(e) => setHttpAllowed(e.target.checked)}
                  style={{ accentColor: 'var(--accent)' }}
                />
                {t('heraldFieldHttpAllowed')}
              </label>
              {httpAllowed && (
                <div
                  role="alert"
                  style={{
                    padding: '6px 10px',
                    borderRadius: 'var(--radius)',
                    background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
                    border: '1px solid var(--danger)',
                    fontSize: 12,
                    color: 'var(--danger)',
                  }}
                >
                  {t('heraldFieldHttpAllowedWarn')}
                </div>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  data-testid="herald-allow-private"
                  checked={allowPrivate}
                  onChange={(e) => setAllowPrivate(e.target.checked)}
                  style={{ accentColor: 'var(--accent)' }}
                />
                {t('heraldFieldAllowPrivate')}
              </label>
              {allowPrivate && (
                <div
                  role="alert"
                  style={{
                    padding: '6px 10px',
                    borderRadius: 'var(--radius)',
                    background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
                    border: '1px solid var(--danger)',
                    fontSize: 12,
                    color: 'var(--danger)',
                  }}
                >
                  {t('heraldFieldAllowPrivateWarn')}
                </div>
              )}
            </div>
          )}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            data-testid="herald-enabled-checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            style={{ accentColor: 'var(--accent)' }}
          />
          {t('heraldFieldEnabled')}
        </label>

        {error ? (
          <div role="alert" className={styles.errorBox}>
            {error instanceof ApiError
              ? String(error.status) + ': ' + error.message
              : String(error)}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={isPending}>
            {tc('cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={isPending || !url}>
            {editing ? tc('save') : tc('create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
