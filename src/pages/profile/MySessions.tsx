// Profile → Sessions: the caller's web sessions — its tokens of kind session
// (GET /v1/me/jwts) — as a person recognises them: browser and system, address,
// when signed in and last active. One ends with POST /v1/me/jwts/{id}/revoke;
// all, or all but this browser's, with POST /v1/me/sessions/revoke. Ending
// this browser's session signs it out.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Monitor, Smartphone, Terminal } from 'lucide-react';
import { keeperApi, type OperatorJWT } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { tokenStore } from '../../api/tokenStore';
import { useAuth } from '../../hooks/useAuth';
import { Badge, Button, Modal, Pager } from '../../components/primitives';
import { summarizeUserAgent } from './userAgent';
import styles from '../common.module.css';
import own from './MySessions.module.css';

const PAGE = 50;
const LIST_KEY = ['me.sessions'] as const;
const ACTIVE_KEY = ['me.sessions.active'] as const;
// last_used_* is written at most once per five minutes per Keeper.
const ACTIVE_NOW_MS = 5 * 60_000;

function fmt(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '';
}

function ago(iso: string, lang: string): string {
  const seconds = Math.round((Date.parse(iso) - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const abs = Math.abs(seconds);
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86400), 'day');
}

type Confirm = 'all' | 'others';

export function MySessions() {
  const { t, i18n } = useTranslation();
  const { identity, logout, forgetSession } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showEnded, setShowEnded] = useState(false);
  const [offset, setOffset] = useState(0);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // This browser is signed in with a session (not a pasted token) and this is its id.
  const hereIsSession = tokenStore.isSession();
  const currentId = identity?.jwtId ?? null;

  const query = { kind: ['session' as const], state: showEnded ? undefined : ('active' as const), offset, limit: PAGE };
  const list = useQuery({
    queryKey: [...LIST_KEY, query],
    queryFn: () => keeperApi.me.jwts.list(query),
    placeholderData: keepPreviousData,
  });
  const active = useQuery({
    queryKey: ACTIVE_KEY,
    queryFn: () => keeperApi.me.jwts.list({ kind: ['session'], state: 'active', limit: 1 }),
  });
  const activeCount = active.data?.total ?? 0;
  const othersCount = hereIsSession ? Math.max(0, activeCount - 1) : activeCount;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: [...LIST_KEY] });
    qc.invalidateQueries({ queryKey: [...ACTIVE_KEY] });
  };
  const failed = (err: unknown) =>
    setError(err instanceof ApiError ? t('errors:generic', { status: err.status, detail: err.message }) : String(err));

  const signOut = () => void logout().then(() => navigate('/login', { replace: true }));

  const endOne = useMutation({
    mutationFn: (row: OperatorJWT) => keeperApi.me.jwts.revoke(row.jwt_id),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: failed,
  });

  const endMany = useMutation({
    mutationFn: (which: Confirm) => keeperApi.me.sessions.revokeAll(which === 'others'),
    onSuccess: (reply, which) => {
      setConfirm(null);
      setError(null);
      if (which === 'all' && hereIsSession) {
        forgetSession();
        navigate('/login', { replace: true });
        return;
      }
      setNotice(t('profile:sessionsEnded', { n: reply.revoked }));
      refresh();
    },
    onError: (err) => {
      setConfirm(null);
      failed(err);
    },
  });

  const items = list.data?.items ?? [];
  const now = Date.now();

  return (
    <section className={styles.section} aria-label={t('profile:tabSessions')}>
      <h2 className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>{t('profile:sessionsTitle')}</span>
        {active.data ? <Badge tone="muted">{t('profile:sessionsActiveCount', { n: activeCount })}</Badge> : null}
        <span style={{ flex: 1 }} />
        <Button
          type="button"
          data-testid="sessions-end-others"
          disabled={!active.data || othersCount === 0 || endMany.isPending}
          onClick={() => setConfirm('others')}
        >
          {t('profile:sessionsEndOthers')}
        </Button>
        <Button
          type="button"
          variant="danger"
          data-testid="sessions-end-all"
          disabled={!active.data || activeCount === 0 || endMany.isPending}
          onClick={() => setConfirm('all')}
        >
          {t('profile:sessionsEndAll')}
        </Button>
      </h2>
      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {t('profile:sessionsHint')}
      </p>
      <label className={own.toggle}>
        <input
          type="checkbox"
          checked={showEnded}
          data-testid="sessions-show-ended"
          onChange={(e) => {
            setShowEnded(e.target.checked);
            setOffset(0);
          }}
        />
        {t('profile:sessionsShowEnded')}
      </label>
      {notice ? (
        <div className={own.notice} role="status" data-testid="sessions-notice">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className={styles.errorBox} role="alert" data-testid="sessions-error">
          {error}
        </div>
      ) : null}

      {list.isLoading ? (
        <div className={styles.loading}>{t('loading')}</div>
      ) : list.error ? (
        <div className={styles.errorBox} role="alert">
          {list.error instanceof ApiError
            ? t('errors:generic', { status: list.error.status, detail: list.error.message })
            : String(list.error)}
        </div>
      ) : items.length === 0 ? (
        <div className={styles.empty} data-testid="sessions-empty">
          {showEnded ? t('profile:sessionsEmptyAll') : t('profile:sessionsEmpty')}
        </div>
      ) : (
        <ul className={own.list} data-testid="sessions-list">
          {items.map((row) => {
            const ua = summarizeUserAgent(row.created_user_agent);
            const Icon = ua.device === 'mobile' ? Smartphone : ua.device === 'tool' ? Terminal : Monitor;
            const title = [ua.browser ?? t('profile:sessionUnknownBrowser'), ua.os].filter(Boolean).join(' · ');
            const current = currentId !== null && row.jwt_id === currentId;
            const live = !row.revoked_at && Date.parse(row.expires_at) > now;
            const lastUsed = row.last_used_at
              ? now - Date.parse(row.last_used_at) < ACTIVE_NOW_MS
                ? t('profile:sessionActiveNow')
                : t('profile:sessionActiveAgo', { ago: ago(row.last_used_at, i18n.language) })
              : t('profile:sessionNotUsed');
            const lastFrom =
              row.last_used_ip && row.last_used_ip !== row.created_ip ? ` ${t('profile:sessionActiveFrom', { ip: row.last_used_ip })}` : '';
            const end = row.revoked_at
              ? t('profile:sessionEndedAt', { at: fmt(row.revoked_at) })
              : live
                ? t('profile:sessionExpires', { at: fmt(row.expires_at) })
                : t('profile:sessionExpiredAt', { at: fmt(row.expires_at) });
            return (
              <li key={row.jwt_id} className={live ? own.item : `${own.item} ${own.ended}`} data-testid={`session-${row.jwt_id}`}>
                <span className={own.icon}>
                  <Icon size={16} aria-hidden="true" />
                </span>
                <div>
                  <div className={own.title} title={row.created_user_agent ?? undefined}>
                    {title}
                    {current ? <Badge tone="ok">{t('profile:sessionThis')}</Badge> : null}
                  </div>
                  <div className={own.meta}>
                    {row.created_ip ? (
                      <>
                        IP <span className="mono">{row.created_ip}</span> ·{' '}
                      </>
                    ) : null}
                    {t('profile:sessionSignedIn', { at: fmt(row.created_at) })} · {lastUsed}
                    {lastFrom} · {end}
                  </div>
                </div>
                {live ? (
                  <Button
                    type="button"
                    variant="danger"
                    data-testid={`session-end-${row.jwt_id}`}
                    disabled={endOne.isPending}
                    onClick={() => (current ? signOut() : endOne.mutate(row))}
                  >
                    {current ? t('profile:sessionLogout') : t('profile:sessionEnd')}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {list.data && list.data.total > PAGE ? (
        <div style={{ marginTop: 10 }}>
          <Pager offset={offset} limit={PAGE} total={list.data.total} shown={items.length} onChange={setOffset} />
        </div>
      ) : null}

      <Modal
        open={confirm !== null}
        title={confirm === 'others' ? t('profile:confirmEndOthersTitle') : t('profile:confirmEndAllTitle')}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button type="button" onClick={() => setConfirm(null)}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              data-testid="sessions-confirm"
              disabled={endMany.isPending}
              onClick={() => confirm && endMany.mutate(confirm)}
            >
              {confirm === 'others' ? t('profile:sessionsEndOthers') : t('profile:sessionsEndAll')}
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          {confirm === 'others'
            ? t('profile:confirmEndOthersBody', { n: othersCount })
            : hereIsSession
              ? t('profile:confirmEndAllBody', { n: activeCount })
              : t('profile:confirmEndAllBodyNoSession', { n: activeCount })}
        </p>
      </Modal>
    </section>
  );
}
