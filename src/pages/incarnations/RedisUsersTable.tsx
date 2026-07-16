import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Eye, EyeOff, Users } from 'lucide-react';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import type { RedisUser } from './redisUsers.helpers';
import styles from '../common.module.css';

// A revealed password auto-hides after 30s (value lives only in local state).
const AUTO_HIDE_MS = 30_000;

interface Props {
  incarnationName: string;
  // secret_id from discovery (e.g. "user_password") — what we're revealing.
  secretId: string;
  users: RedisUser[];
  // Usernames the backend allows revealing (discovery keys).
  revealableKeys: string[];
}

type ToastKind = 'ok' | 'warn' | 'danger';
interface Toast {
  kind: ToastKind;
  msg: string;
}

function asText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

const TOAST_BG: Record<ToastKind, string> = {
  ok: 'var(--success, #2d7a4f)',
  warn: 'var(--warn, #b07f00)',
  danger: 'var(--danger, #b3261e)',
};

// Table of Redis ACL users from state.redis_users. The eye icon (UX gate incarnation.view-secrets)
// reveals the password inline on click — value is fetched lazily and not cached in react-query.
export function RedisUsersTable({ incarnationName, secretId, users, revealableKeys }: Props) {
  const { t } = useTranslation();
  const { hasPermission } = useMyPermissions();
  const canView = hasPermission('incarnation.view-secrets');
  const revealSet = new Set(revealableKeys);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ key: string; value: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  // Auto-hide: reset the timer on a new reveal and clear the value on unmount.
  useEffect(() => {
    if (!revealed) return;
    const id = setTimeout(() => {
      setRevealed(null);
      setCopiedKey(null);
    }, AUTO_HIDE_MS);
    return () => clearTimeout(id);
  }, [revealed]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  async function onReveal(key: string) {
    setBusyKey(key);
    try {
      const reply = await keeperApi.incarnations.revealSecret(incarnationName, {
        secret_id: secretId,
        key,
      });
      setRevealed({ key, value: reply.value });
      setCopiedKey(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setToast({ kind: 'danger', msg: t('incarnations:revealForbidden') });
      } else if (err instanceof ApiError && err.status === 404) {
        setToast({ kind: 'warn', msg: t('incarnations:revealNotFound') });
      } else {
        setToast({
          kind: 'danger',
          msg: t('incarnations:revealFailed', {
            detail: err instanceof ApiError ? err.message : String(err),
          }),
        });
      }
    } finally {
      setBusyKey(null);
    }
  }

  async function onCopy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setToast({ kind: 'ok', msg: t('incarnations:revealCopied') });
    } catch {
      window.prompt(t('incarnations:revealCopyPrompt'), value);
    }
  }

  return (
    <>
      <h3 className={styles.sectionTitle} style={{ fontSize: 14, marginTop: 8 }}>
        <Users size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
        Redis Users ({users.length})
      </h3>
      <table className={styles.table} data-testid="redis-users-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Perms</th>
            <th>State</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const revealable = revealSet.has(u.name);
            const isRevealed = revealed?.key === u.name;
            return (
              <tr key={u.name}>
                <td className="mono">{u.name}</td>
                <td className="mono">{asText(u.perms) || '—'}</td>
                <td className="mono">{asText(u.state) || '—'}</td>
                <td>
                  {revealable && canView ? (
                    isRevealed ? (
                      <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          readOnly
                          value={revealed.value}
                          data-testid={`reveal-value-${u.name}`}
                          aria-label={t('incarnations:revealValueAria', { name: u.name })}
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 12,
                            padding: '4px 8px',
                            background: 'var(--surface-2)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius)',
                            minWidth: 160,
                          }}
                        />
                        <button
                          type="button"
                          data-testid={`reveal-copy-${u.name}`}
                          onClick={() => onCopy(revealed.value, u.name)}
                          style={secretBtnStyle}
                        >
                          <Copy size={12} /> {copiedKey === u.name ? t('copied') : t('copy')}
                        </button>
                        <button
                          type="button"
                          data-testid={`reveal-hide-${u.name}`}
                          aria-label={t('incarnations:revealHide')}
                          title={t('incarnations:revealHide')}
                          onClick={() => {
                            setRevealed(null);
                            setCopiedKey(null);
                          }}
                          style={secretBtnStyle}
                        >
                          <EyeOff size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        data-testid={`reveal-eye-${u.name}`}
                        aria-label={t('incarnations:revealShow', { name: u.name })}
                        title={t('incarnations:revealShow', { name: u.name })}
                        disabled={busyKey === u.name}
                        onClick={() => onReveal(u.name)}
                        style={secretBtnStyle}
                      >
                        <Eye size={14} />
                      </button>
                    )
                  ) : (
                    <span style={{ color: 'var(--text-faint)' }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="state-toast"
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 1000,
            background: TOAST_BG[toast.kind],
            color: '#fff',
            padding: '10px 18px',
            borderRadius: 'var(--radius)',
            fontSize: 13,
            boxShadow: '0 2px 12px rgba(0,0,0,.25)',
          }}
        >
          {toast.msg}
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label={t('close')}
            style={{ marginLeft: 12, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14 }}
          >
            ×
          </button>
        </div>
      ) : null}
    </>
  );
}

const secretBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'transparent',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 12,
};
