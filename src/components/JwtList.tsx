// The token list shared by Profile → Tokens (the caller's own, GET /v1/me/jwts)
// and the operator card (GET /v1/operators/{aid}/jwts). Every filter goes to the
// server (kind / state / q + offset paging), so the list stays usable at hundreds
// of tokens per operator — nothing is filtered client-side.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JWTListQuery, JWTState, OperatorJWT, OperatorJWTKind } from '../api/keeper';
import { ApiError } from '../api/client';
import { Badge, Button, Modal, Pager } from './primitives';
import styles from '../pages/common.module.css';

const PAGE = 50;

export interface JwtPage {
  items?: OperatorJWT[] | null;
  offset: number;
  limit: number;
  total: number;
}

interface Props {
  queryKey: readonly unknown[];
  fetchPage: (q: JWTListQuery) => Promise<JwtPage>;
  // The kinds this list covers; "all kinds" means these, not every kind there is.
  kinds: OperatorJWTKind[];
  showCreatedBy?: boolean;
  // The token this browser is signed in with, marked in the list and warned
  // about on revoke (revoking it signs the browser out).
  currentJwtId?: string | null;
  canRevoke: boolean;
  revoke: (jwtId: string) => Promise<void>;
  onRevoked?: (row: OperatorJWT) => void;
  // Lets a parent refetch its own queries (counts, ceilings) after a revoke.
  invalidateKeys?: readonly (readonly unknown[])[];
  // Words a refused revoke for the route at hand; the generic status line otherwise.
  formatError?: (err: unknown) => string;
}

function stateOf(row: OperatorJWT, now: number): JWTState {
  if (row.revoked_at) return 'revoked';
  return Date.parse(row.expires_at) <= now ? 'expired' : 'active';
}

function fmt(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '';
}

function clientLine(ip?: string, ua?: string): string {
  return [ip, ua].filter(Boolean).join(' · ');
}

function kindTone(k: OperatorJWTKind): 'info' | 'warn' | 'muted' {
  if (k === 'personal') return 'info';
  if (k === 'bootstrap') return 'warn';
  return 'muted';
}

export function JwtList({
  queryKey,
  fetchPage,
  kinds,
  showCreatedBy,
  currentJwtId,
  canRevoke,
  revoke,
  onRevoked,
  invalidateKeys = [],
  formatError,
}: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [state, setState] = useState<JWTState | ''>('active');
  const [kind, setKind] = useState<OperatorJWTKind | ''>('');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [confirm, setConfirm] = useState<OperatorJWT | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setQ(qInput.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(id);
  }, [qInput]);

  const query: JWTListQuery = {
    kind: kind ? [kind] : kinds,
    state: state || undefined,
    q: q || undefined,
    offset,
    limit: PAGE,
  };
  const list = useQuery({
    queryKey: [...queryKey, query],
    queryFn: () => fetchPage(query),
    placeholderData: keepPreviousData,
  });

  const revokeMut = useMutation({
    mutationFn: (row: OperatorJWT) => revoke(row.jwt_id),
    onSuccess: (_, row) => {
      setConfirm(null);
      setRevokeError(null);
      qc.invalidateQueries({ queryKey: [...queryKey] });
      for (const k of invalidateKeys) qc.invalidateQueries({ queryKey: [...k] });
      onRevoked?.(row);
    },
    onError: (err) => {
      if (formatError) setRevokeError(formatError(err));
      else setRevokeError(err instanceof ApiError ? t('errors:generic', { status: err.status, detail: err.message }) : String(err));
    },
  });

  const now = Date.now();
  const items = list.data?.items ?? [];
  const STATES: { id: JWTState | ''; labelKey: string }[] = [
    { id: 'active', labelKey: 'profile:stateActive' },
    { id: 'revoked', labelKey: 'profile:stateRevoked' },
    { id: 'expired', labelKey: 'profile:stateExpired' },
    { id: '', labelKey: 'profile:stateAll' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <div className={styles.filters}>
        <Segmented
          ariaLabel={t('profile:filterStateAria')}
          options={STATES.map((s) => ({ id: s.id, label: t(s.labelKey) }))}
          value={state}
          onChange={(v) => {
            setState(v as JWTState | '');
            setOffset(0);
          }}
          testId="jwt-filter-state"
        />
        {kinds.length > 1 ? (
          <Segmented
            ariaLabel={t('profile:filterKindAria')}
            options={[{ id: '', label: t('profile:kindAll') }, ...kinds.map((k) => ({ id: k, label: k }))]}
            value={kind}
            onChange={(v) => {
              setKind(v as OperatorJWTKind | '');
              setOffset(0);
            }}
            testId="jwt-filter-kind"
          />
        ) : null}
        <input
          type="search"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder={t('profile:searchLabel')}
          aria-label={t('profile:searchLabel')}
          data-testid="jwt-filter-q"
          maxLength={200}
          style={{
            padding: '5px 9px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontSize: 12.5,
            minWidth: 200,
          }}
        />
      </div>

      {list.isLoading ? (
        <div className={styles.loading}>{t('loading')}</div>
      ) : list.error ? (
        <div className={styles.errorBox} role="alert">
          {list.error instanceof ApiError
            ? t('errors:generic', { status: list.error.status, detail: list.error.message })
            : String(list.error)}
        </div>
      ) : items.length === 0 ? (
        <div className={styles.empty} data-testid="jwt-list-empty">{t('profile:noTokens')}</div>
      ) : (
        <table className={styles.table} data-testid="jwt-list">
          <thead>
            <tr>
              <th>{t('profile:colLabel')}</th>
              <th>{t('profile:colKind')}</th>
              {showCreatedBy ? <th>{t('common:colCreatedBy')}</th> : null}
              <th>{t('profile:colIssued')}</th>
              <th>{t('profile:colExpires')}</th>
              <th>{t('profile:colLastUsed')}</th>
              <th>{t('profile:colState')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const st = stateOf(row, now);
              const current = Boolean(currentJwtId) && row.jwt_id === currentJwtId;
              return (
                <tr key={row.jwt_id} data-testid={`jwt-row-${row.jwt_id}`}>
                  <td>
                    {row.label || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    {current ? (
                      <>
                        {' '}
                        <Badge tone="ok">{t('profile:thisSignIn')}</Badge>
                      </>
                    ) : null}
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.jwt_id}</div>
                  </td>
                  <td>
                    <Badge tone={kindTone(row.kind)}>{row.kind}</Badge>
                  </td>
                  {showCreatedBy ? (
                    <td className="mono" style={{ fontSize: 12 }}>
                      {row.created_by_aid ?? '—'}
                    </td>
                  ) : null}
                  <td>
                    {fmt(row.created_at)}
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {clientLine(row.created_ip, row.created_user_agent)}
                    </div>
                  </td>
                  <td>{fmt(row.expires_at)}</td>
                  <td>
                    {row.last_used_at ? fmt(row.last_used_at) : <span style={{ color: 'var(--text-muted)' }}>{t('profile:neverUsed')}</span>}
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {clientLine(row.last_used_ip, row.last_used_user_agent)}
                    </div>
                  </td>
                  <td>
                    {st === 'active' ? (
                      <Badge tone="ok">{t('profile:stateActiveOne')}</Badge>
                    ) : st === 'revoked' ? (
                      <Badge tone="danger">{t('profile:stateRevokedOne')}</Badge>
                    ) : (
                      <Badge tone="muted">{t('profile:stateExpiredOne')}</Badge>
                    )}
                    {row.revoked_at ? (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {fmt(row.revoked_at)}
                        {row.revoked_by_aid ? ` · ${row.revoked_by_aid}` : ''}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {canRevoke && st === 'active' ? (
                      <Button
                        type="button"
                        variant="danger"
                        data-testid={`jwt-revoke-${row.jwt_id}`}
                        onClick={() => {
                          setRevokeError(null);
                          setConfirm(row);
                        }}
                      >
                        {t('revoke')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {list.data && list.data.total > 0 ? (
        <Pager
          offset={list.data.offset}
          limit={list.data.limit}
          total={list.data.total}
          shown={items.length}
          onChange={setOffset}
        />
      ) : null}

      <Modal
        open={confirm !== null}
        title={t('profile:revokeTitle')}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button type="button" onClick={() => setConfirm(null)}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              data-testid="jwt-revoke-confirm"
              disabled={revokeMut.isPending}
              onClick={() => confirm && revokeMut.mutate(confirm)}
            >
              {t('revoke')}
            </Button>
          </>
        }
      >
        {confirm ? (
          <>
            <p style={{ margin: '0 0 8px', fontSize: 13 }}>
              {t('profile:revokeBody', { label: confirm.label || confirm.jwt_id })}
            </p>
            {confirm.jwt_id === currentJwtId ? (
              <div className={styles.errorBox} role="alert" data-testid="jwt-revoke-current-warn">
                {t('profile:revokeCurrentWarn')}
              </div>
            ) : null}
            {revokeError ? (
              <div className={styles.errorBox} role="alert" data-testid="jwt-revoke-error">
                {revokeError}
              </div>
            ) : null}
          </>
        ) : null}
      </Modal>
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
  ariaLabel,
  testId,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  testId: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-testid={testId}
      style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}
    >
      {options.map((o) => (
        <button
          key={o.id || 'all'}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          data-testid={`${testId}-${o.id || 'all'}`}
          onClick={() => onChange(o.id)}
          style={{
            padding: '4px 10px',
            border: 0,
            borderRight: '1px solid var(--border)',
            background: value === o.id ? 'var(--surface-2)' : 'var(--surface)',
            color: value === o.id ? 'var(--text)' : 'var(--text-muted)',
            fontWeight: value === o.id ? 600 : 400,
            fontSize: 12.5,
            cursor: 'pointer',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
