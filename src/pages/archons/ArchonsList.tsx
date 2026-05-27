import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  keeperApi,
  type OperatorCreateReply,
  type IssueTokenReply,
  type OperatorAuthMethod,
  type Operator,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button, Input } from '../../components/primitives';
import { RevokeArchonModal } from './RevokeArchonModal';
import styles from '../common.module.css';

// AID-валидатор симметричен openapi pattern '^archon-[a-z0-9-]{1,62}$'.
const AID_PATTERN = /^archon-[a-z0-9-]{1,62}$/;

const AUTH_METHODS: OperatorAuthMethod[] = ['jwt', 'mtls', 'combined'];

function authMethodTone(m: OperatorAuthMethod | string | undefined):
  'ok' | 'warn' | 'info' | 'muted' {
  switch (m) {
    case 'mtls':
      return 'ok';
    case 'combined':
      return 'info';
    case 'jwt':
      return 'warn';
    default:
      return 'muted';
  }
}

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

function ArchonsTable({ items, onIssue, onRevoke }: {
  items: Operator[];
  onIssue: (aid: string) => void;
  onRevoke: (aid: string) => void;
}) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>AID</th>
          <th>Display name</th>
          <th>Auth</th>
          <th>Created</th>
          <th>Created by</th>
          <th>Revoked</th>
          <th>Bootstrap</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {items.map((op) => {
          const revoked = Boolean(op.revoked_at);
          return (
            <tr key={op.aid}>
              <td>
                <Link to={`/archons/${encodeURIComponent(op.aid)}`}>{op.aid}</Link>
              </td>
              <td>{op.display_name}</td>
              <td><Badge tone={authMethodTone(op.auth_method)}>{op.auth_method}</Badge></td>
              <td className="mono">{op.created_at}</td>
              <td className="mono">{op.created_by_aid ?? '—'}</td>
              <td className="mono">{op.revoked_at ?? '—'}</td>
              <td>{op.bootstrap_initial ? <Badge tone="info">initial</Badge> : '—'}</td>
              <td>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    disabled={revoked}
                    onClick={() => onIssue(op.aid)}
                    title={revoked ? 'Архонт отозван' : 'Выпустить новый JWT'}
                    style={{
                      padding: '4px 8px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      background: 'transparent',
                      cursor: revoked ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                    }}
                  >
                    Issue token
                  </button>
                  <button
                    disabled={revoked}
                    onClick={() => onRevoke(op.aid)}
                    title={revoked ? 'Уже отозван' : 'Отозвать Архонта'}
                    style={{
                      padding: '4px 8px',
                      border: '1px solid var(--danger)',
                      borderRadius: 'var(--radius)',
                      background: 'transparent',
                      color: revoked ? 'var(--text-faint)' : 'var(--danger)',
                      cursor: revoked ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                    }}
                  >
                    Revoke
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ArchonsList() {
  const qc = useQueryClient();

  const [aidNew, setAidNew] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [revealed, setRevealed] = useState<{ jwt: string; expiresAt?: string } | null>(null);

  const [authMethod, setAuthMethod] = useState<OperatorAuthMethod | ''>('');
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [revokingAid, setRevokingAid] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['operators.list', { authMethod, includeRevoked, limit, offset }],
    queryFn: () =>
      keeperApi.operators.list({
        auth_method: authMethod || undefined,
        revoked: includeRevoked || undefined,
        limit,
        offset,
      }),
  });

  const createMut = useMutation({
    mutationFn: () => keeperApi.operators.create({ aid: aidNew, display_name: displayName }),
    onSuccess: (reply: OperatorCreateReply) => {
      setRevealed({ jwt: reply.jwt });
      setAidNew('');
      setDisplayName('');
      qc.invalidateQueries({ queryKey: ['operators.list'] });
    },
  });

  const issueMut = useMutation({
    mutationFn: (aid: string) => keeperApi.operators.issueToken(aid),
    onSuccess: (reply: IssueTokenReply) => {
      setRevealed({ jwt: reply.jwt, expiresAt: reply.expires_at });
    },
  });

  const aidNewValid = AID_PATTERN.test(aidNew);

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Archons</h1>
          <div className={styles.crumbs}>операторы кластера (ADR-013/014)</div>
        </div>
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

      <section className={styles.section} aria-label="Список Архонтов">
        <h2 className={styles.sectionTitle}>Существующие</h2>
        <div className={styles.filters}>
          <label>
            <div className={styles.metaKey}>Auth method</div>
            <select
              value={authMethod}
              onChange={(e) => { setAuthMethod(e.target.value as OperatorAuthMethod | ''); setOffset(0); }}
              style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)' }}
            >
              <option value="">— все —</option>
              {AUTH_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className={styles.metaKey}>Включая revoked</span>
            <input
              type="checkbox"
              checked={includeRevoked}
              onChange={(e) => { setIncludeRevoked(e.target.checked); setOffset(0); }}
              style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
            />
          </label>
          <label>
            <div className={styles.metaKey}>Limit</div>
            <input
              type="number"
              min={1}
              max={200}
              value={limit}
              onChange={(e) => { setLimit(Math.max(1, Math.min(200, Number(e.target.value) || 50))); setOffset(0); }}
              style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', width: 80 }}
            />
          </label>
        </div>

        {list.isLoading ? <div className={styles.loading}>Загружаем…</div> : null}
        {list.error ? (
          <div className={styles.errorBox}>
            {list.error instanceof ApiError ? `Ошибка ${list.error.status}: ${list.error.message}` : String(list.error)}
          </div>
        ) : null}

        {list.data && items.length === 0 ? (
          <div className={styles.empty}>Архонтов под фильтр не найдено.</div>
        ) : null}

        {items.length > 0 ? (
          <>
            <ArchonsTable
              items={items}
              onIssue={(aid) => issueMut.mutate(aid)}
              onRevoke={(aid) => setRevokingAid(aid)}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: 'var(--text-muted)' }}>
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                style={{ padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'transparent', cursor: offset === 0 ? 'not-allowed' : 'pointer' }}
              >
                ← Prev
              </button>
              <span>{offset + 1}–{offset + items.length} of {total}</span>
              <button
                disabled={offset + limit >= total}
                onClick={() => setOffset(offset + limit)}
                style={{ padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'transparent', cursor: offset + limit >= total ? 'not-allowed' : 'pointer' }}
              >
                Next →
              </button>
            </div>
          </>
        ) : null}

        {issueMut.error ? (
          <div className={styles.errorBox}>
            {issueMut.error instanceof ApiError
              ? `Ошибка ${issueMut.error.status}: ${issueMut.error.message}`
              : String(issueMut.error)}
          </div>
        ) : null}
      </section>

      {revokingAid ? (
        <RevokeArchonModal
          aid={revokingAid}
          open={true}
          onClose={() => setRevokingAid(null)}
        />
      ) : null}
    </div>
  );
}
