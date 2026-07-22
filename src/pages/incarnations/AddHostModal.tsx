import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import i18n from '../../i18n';
import styles from '../common.module.css';

// Add host to the declared spec.hosts[] of the incarnation (PATCH .../hosts, mode=append).
// SID is chosen from the souls registry (not free text — the backend still
// validates existence, but a select removes a class of typos). role —
// optional kebab-case text.
//
// 422 unknown-SID / 409 destroying / 404 — pretty error in the modal.

const ROLE_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

interface Props {
  open: boolean;
  incarnationName: string;
  // SIDs already present in declared spec.hosts[] — excluded from the select.
  existingSids: string[];
  onClose: () => void;
}

function prettyError(err: unknown): string {
  const t = i18n.t.bind(i18n);
  if (err instanceof ApiError) {
    if (err.status === 422) return t('incarnations:addHostUnknownSid', { detail: err.detail });
    if (err.status === 409) return t('incarnations:removeBlocked409');
    if (err.status === 404) return t('incarnations:incarnationNotFound');
    return t('errors:generic', { status: err.status, detail: err.message });
  }
  return String(err);
}

export function AddHostModal({ open, incarnationName, existingSids, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [sid, setSid] = useState('');
  const [role, setRole] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  // List of souls for the select. Fetched only while the modal is open.
  const souls = useQuery({
    queryKey: ['souls-for-add-host'],
    queryFn: () => keeperApi.souls.list({ limit: 500 }),
    enabled: open,
  });

  const existing = new Set(existingSids);
  const candidates = (souls.data?.items ?? []).filter((s) => !existing.has(s.sid));

  const mu = useMutation({
    mutationFn: () =>
      keeperApi.incarnations.updateHosts(incarnationName, {
        mode: 'append',
        hosts: [{ sid, ...(role.trim() ? { role: role.trim() } : {}) }],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incarnation', incarnationName] });
      qc.invalidateQueries({ queryKey: ['incarnation-souls', incarnationName] });
      close();
    },
    onError: (err) => setServerError(prettyError(err)),
  });

  function close() {
    setSid('');
    setRole('');
    setConfirmed(false);
    setFormError(null);
    setServerError(null);
    onClose();
  }

  function submit() {
    setFormError(null);
    setServerError(null);
    if (!sid) {
      setFormError(t('errors:selectHostSid'));
      return;
    }
    const r = role.trim();
    if (r && (!ROLE_PATTERN.test(r) || r.length > 63)) {
      setFormError(t('incarnations:roleKebab'));
      return;
    }
    // Forced addition bypassing the add-scenario reconciliation — requires
    // explicit confirmation of the dangerous operation.
    if (!confirmed) {
      setFormError(t('incarnations:forceAddNotConfirmed'));
      return;
    }
    mu.mutate();
  }

  return (
    <Modal
      open={open}
      title={t('forms:addHostTitle', { name: incarnationName })}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={submit}
            disabled={mu.isPending || !confirmed}
            data-testid="force-add-confirm"
          >
            {mu.isPending ? t('adding') : t('add')}
          </Button>
        </>
      }
    >
      <form noValidate>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          {t('incarnations:addHostDesc')}
        </p>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: 13 }}>SID</span>
          {souls.isLoading ? (
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{t('incarnations:soulsLoading')}</span>
          ) : (
            <select
              value={sid}
              onChange={(e) => setSid(e.target.value)}
              aria-label={t('incarnations:sidHostAria')}
              style={selectStyle}
            >
              <option value="">{t('incarnations:selectSid')}</option>
              {candidates.map((s) => (
                <option key={s.sid} value={s.sid}>
                  {s.sid}
                  {s.status ? ` (${s.status})` : ''}
                </option>
              ))}
            </select>
          )}
          {souls.data && candidates.length === 0 ? (
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {t('incarnations:allDeclaredSouls')}
            </span>
          ) : null}
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13 }}>{t('incarnations:roleOptional')}</span>
          <input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder={t('incarnations:rolePlaceholder')}
            spellCheck={false}
            style={inputStyle}
          />
        </label>

        <div
          className={styles.errorBox}
          style={{ marginTop: 16, fontSize: 12.5, lineHeight: 1.5 }}
          data-testid="force-add-warning"
        >
          <strong>{t('incarnations:forceAddWarningTitle')}</strong> {t('incarnations:forceAddWarningBody')}
        </div>
        <label
          style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, fontSize: 13 }}
        >
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            aria-label={t('incarnations:forceAddConfirmAria')}
          />
          <span>{t('incarnations:forceAddConfirmLabel')}</span>
        </label>

        {formError ? <div className={styles.errorBox} style={{ marginTop: 12 }}>{formError}</div> : null}
        {serverError ? <div className={styles.errorBox} style={{ marginTop: 12 }}>{serverError}</div> : null}
      </form>
    </Modal>
  );
}

const selectStyle = {
  padding: '8px 10px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  fontFamily: 'var(--font-mono)',
} as const;

const inputStyle = {
  padding: '8px 10px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  fontFamily: 'var(--font-mono)',
} as const;
