import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import styles from '../common.module.css';

// Add host в declared spec.hosts[] incarnation (PATCH .../hosts, mode=append).
// SID выбирается из реестра souls (а не свободный ввод — backend всё равно
// валидирует существование, но select убирает класс опечаток). role —
// опциональный kebab-case-текст.
//
// 422 unknown-SID / 409 destroying / 404 — pretty-error в модалке.

const ROLE_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

interface Props {
  open: boolean;
  incarnationName: string;
  // SID-ы, уже присутствующие в declared spec.hosts[] — исключаем из select.
  existingSids: string[];
  onClose: () => void;
}

function prettyError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 422) return `Неизвестный SID — хост не зарегистрирован в реестре souls. ${err.detail}`;
    if (err.status === 409) return 'Incarnation в состоянии destroying — правка spec.hosts невозможна.';
    if (err.status === 404) return 'Incarnation не найдена.';
    return `Ошибка ${err.status}: ${err.message}`;
  }
  return String(err);
}

export function AddHostModal({ open, incarnationName, existingSids, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [sid, setSid] = useState('');
  const [role, setRole] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  // Список souls для select. Подгружаем только при открытой модалке.
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
      setFormError('Role — kebab-case (lowercase, цифры, дефис-разделитель), до 63 символов.');
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
          <Button type="button" variant="primary" onClick={submit} disabled={mu.isPending}>
            {mu.isPending ? t('adding') : t('add')}
          </Button>
        </>
      }
    >
      <form noValidate>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          Добавление хоста в declared <code className="mono">spec.hosts[]</code> (mode=append).
          При совпадении SID role обновится.
        </p>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: 13 }}>SID</span>
          {souls.isLoading ? (
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Загружаем souls…</span>
          ) : (
            <select
              value={sid}
              onChange={(e) => setSid(e.target.value)}
              aria-label="SID хоста"
              style={selectStyle}
            >
              <option value="">— выберите SID —</option>
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
              Все зарегистрированные souls уже в declared-списке.
            </span>
          ) : null}
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13 }}>Role (опционально)</span>
          <input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="master / replica / …"
            spellCheck={false}
            style={inputStyle}
          />
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
