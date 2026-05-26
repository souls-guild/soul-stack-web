import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  keeperApi,
  type OperatorCreateReply,
  type IssueTokenReply,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Button, Input } from '../../components/primitives';
import styles from '../common.module.css';

// AID-валидатор симметричен openapi pattern '^archon-[a-z0-9-]{1,62}$'.
const AID_PATTERN = /^archon-[a-z0-9-]{1,62}$/;

// JWT отдаётся один раз — показываем в modal-блоке с кнопкой copy.
function JwtReveal({ jwt, expiresAt, onClose }: { jwt: string; expiresAt?: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      role="dialog"
      aria-label="Новый JWT"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--warn, #b07f00)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--s-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <strong>JWT выпущен. Скопируйте сейчас — повторно не покажется.</strong>
      <textarea
        readOnly
        value={jwt}
        rows={4}
        style={{
          width: '100%',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          padding: 8,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          resize: 'vertical',
        }}
      />
      {expiresAt ? (
        <div className={styles.metaKey}>expires_at: <span className="mono">{expiresAt}</span></div>
      ) : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          variant="primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(jwt);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? 'Скопировано' : 'Скопировать'}
        </Button>
        <Button variant="ghost" onClick={onClose}>Закрыть</Button>
      </div>
    </div>
  );
}

export function ArchonsList() {
  const [aidNew, setAidNew] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [aidIssue, setAidIssue] = useState('');
  const [aidRevoke, setAidRevoke] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const [revealed, setRevealed] = useState<{ jwt: string; expiresAt?: string } | null>(null);

  const createMut = useMutation({
    mutationFn: () => keeperApi.operators.create({ aid: aidNew, display_name: displayName }),
    onSuccess: (reply: OperatorCreateReply) => {
      setRevealed({ jwt: reply.jwt });
      setAidNew('');
      setDisplayName('');
    },
  });

  const issueMut = useMutation({
    mutationFn: () => keeperApi.operators.issueToken(aidIssue),
    onSuccess: (reply: IssueTokenReply) => {
      setRevealed({ jwt: reply.jwt, expiresAt: reply.expires_at });
      setAidIssue('');
    },
  });

  const revokeMut = useMutation({
    mutationFn: () => keeperApi.operators.revoke(aidRevoke, { aid: aidRevoke, reason: revokeReason || undefined }),
    onSuccess: () => {
      setAidRevoke('');
      setRevokeReason('');
    },
  });

  const aidNewValid = AID_PATTERN.test(aidNew);
  const aidIssueValid = AID_PATTERN.test(aidIssue);
  const aidRevokeValid = AID_PATTERN.test(aidRevoke);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Archons</h1>
          <div className={styles.crumbs}>операторы кластера (ADR-013/014)</div>
        </div>
      </div>

      <div
        style={{
          background: 'color-mix(in srgb, var(--info, #4b8bff) 6%, var(--surface))',
          border: '1px dashed var(--border)',
          borderRadius: 'var(--radius)',
          padding: 'var(--s-3) var(--s-4)',
          fontSize: 12.5,
          color: 'var(--text-muted)',
        }}
      >
        <code className="mono">GET /v1/operators</code> ещё не выставлен — таблицы существующих
        Архонтов нет. Доступны create / issue-token / revoke по AID.
      </div>

      {revealed ? (
        <JwtReveal jwt={revealed.jwt} expiresAt={revealed.expiresAt} onClose={() => setRevealed(null)} />
      ) : null}

      <section className={styles.section} aria-label="Создать Архонта">
        <h2 className={styles.sectionTitle}>Создать Архонта</h2>
        <div className={styles.filters}>
          <Input
            label="AID"
            value={aidNew}
            onChange={(e) => setAidNew(e.target.value)}
            placeholder="archon-alice"
            mono
            error={aidNew && !aidNewValid ? 'pattern ^archon-[a-z0-9-]{1,62}$' : undefined}
          />
          <Input
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Alice Ops"
          />
          <div style={{ alignSelf: 'flex-end' }}>
            <Button
              variant="primary"
              disabled={!aidNewValid || !displayName || createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              {createMut.isPending ? 'Создаём…' : 'Создать'}
            </Button>
          </div>
        </div>
        {createMut.error ? (
          <div className={styles.errorBox}>
            {createMut.error instanceof ApiError
              ? `Ошибка ${createMut.error.status}: ${createMut.error.message}`
              : String(createMut.error)}
          </div>
        ) : null}
      </section>

      <section className={styles.section} aria-label="Выпустить новый токен">
        <h2 className={styles.sectionTitle}>Выпустить новый JWT</h2>
        <div className={styles.filters}>
          <Input
            label="AID"
            value={aidIssue}
            onChange={(e) => setAidIssue(e.target.value)}
            placeholder="archon-alice"
            mono
            error={aidIssue && !aidIssueValid ? 'pattern ^archon-[a-z0-9-]{1,62}$' : undefined}
          />
          <div style={{ alignSelf: 'flex-end' }}>
            <Button
              variant="primary"
              disabled={!aidIssueValid || issueMut.isPending}
              onClick={() => issueMut.mutate()}
            >
              {issueMut.isPending ? 'Выпускаем…' : 'Issue token'}
            </Button>
          </div>
        </div>
        {issueMut.error ? (
          <div className={styles.errorBox}>
            {issueMut.error instanceof ApiError
              ? `Ошибка ${issueMut.error.status}: ${issueMut.error.message}`
              : String(issueMut.error)}
          </div>
        ) : null}
      </section>

      <section className={styles.section} aria-label="Отозвать Архонта">
        <h2 className={styles.sectionTitle}>Отозвать Архонта</h2>
        <div className={styles.filters}>
          <Input
            label="AID"
            value={aidRevoke}
            onChange={(e) => setAidRevoke(e.target.value)}
            placeholder="archon-alice"
            mono
            error={aidRevoke && !aidRevokeValid ? 'pattern ^archon-[a-z0-9-]{1,62}$' : undefined}
          />
          <Input
            label="Reason"
            value={revokeReason}
            onChange={(e) => setRevokeReason(e.target.value)}
            placeholder="optional"
          />
          <div style={{ alignSelf: 'flex-end' }}>
            <Button
              variant="danger"
              disabled={!aidRevokeValid || revokeMut.isPending}
              onClick={() => {
                if (!window.confirm(`Отозвать ${aidRevoke}? Активные JWT работают до exp.`)) return;
                revokeMut.mutate();
              }}
            >
              {revokeMut.isPending ? 'Отзываем…' : 'Revoke'}
            </Button>
          </div>
        </div>
        {revokeMut.error ? (
          <div className={styles.errorBox}>
            {revokeMut.error instanceof ApiError
              ? `Ошибка ${revokeMut.error.status}: ${revokeMut.error.message}`
              : String(revokeMut.error)}
          </div>
        ) : null}
        {revokeMut.isSuccess ? (
          <div className={styles.empty} style={{ padding: 'var(--s-3)' }}>Архонт отозван.</div>
        ) : null}
      </section>
    </div>
  );
}
