// Profile → Owned Archons: the machine operators the caller owns, directly or
// through a Synod (GET /v1/me/operators), each with its tokens. No permission is
// involved, but the Keeper lets an owner issue or revoke only while the owner's
// own permissions cover the operator's (403 owner-lacks-permissions).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { keeperApi, type OperatorJWTKind } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button, Pager } from '../../components/primitives';
import { JwtList } from '../../components/JwtList';
import { IssueJwtModal } from './IssueJwtModal';
import { prettyOwnedError } from './ownedErrors';
import styles from '../common.module.css';
import own from './ProfilePage.module.css';

const PAGE = 50;
const KINDS: OperatorJWTKind[] = ['personal', 'issued', 'session', 'bootstrap'];
const jwtsKey = (aid: string) => ['me.operators.jwts', aid] as const;

export function MyOwnedArchons() {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  // Explicit toggles; a page holding a single operator starts expanded.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [issueFor, setIssueFor] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['me.operators', offset],
    queryFn: () => keeperApi.me.operators.list({ offset, limit: PAGE }),
    placeholderData: keepPreviousData,
  });
  const items = q.data?.items ?? [];
  const isOpen = (aid: string) => toggled[aid] ?? items.length === 1;

  return (
    <section className={own.section} aria-label={t('profile:tabOwned')} data-testid="owned-archons">
      <div className={own.head}>
        <h2 className={styles.sectionTitle}>{t('profile:tabOwned')}</h2>
        <p className={own.hint}>{t('profile:ownedHint')}</p>
      </div>

      {q.isLoading ? (
        <div className={styles.loading}>{t('loading')}</div>
      ) : q.error ? (
        <div className={styles.errorBox} role="alert">
          {q.error instanceof ApiError
            ? t('errors:generic', { status: q.error.status, detail: q.error.message })
            : String(q.error)}
        </div>
      ) : items.length === 0 ? (
        <div className={styles.empty} data-testid="owned-empty">{t('profile:ownedEmpty')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
          {items.map((op) => {
            const open = isOpen(op.aid);
            return (
              <div
                key={op.aid}
                data-testid={`owned-${op.aid}`}
                style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 'var(--s-4)' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={t('profile:ownedToggleAria', { aid: op.aid })}
                    data-testid={`owned-toggle-${op.aid}`}
                    onClick={() => setToggled((m) => ({ ...m, [op.aid]: !open }))}
                    style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'inline-flex' }}
                  >
                    {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <strong style={{ fontSize: 13.5 }}>{op.display_name || op.aid}</strong>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{op.aid}</span>
                  {op.owner_synod ? <Badge tone="info">{t('profile:ownedViaSynod', { name: op.owner_synod })}</Badge> : null}
                  <span style={{ flex: 1 }} />
                  <Button
                    type="button"
                    variant="primary"
                    data-testid={`owned-issue-${op.aid}`}
                    onClick={() => {
                      setToggled((m) => ({ ...m, [op.aid]: true }));
                      setIssueFor(op.aid);
                    }}
                  >
                    {t('profile:issueToken')}
                  </Button>
                </div>
                {open ? (
                  <div style={{ marginTop: 'var(--s-4)' }}>
                    <JwtList
                      queryKey={jwtsKey(op.aid)}
                      fetchPage={(page) => keeperApi.me.operators.jwts(op.aid, page)}
                      kinds={KINDS}
                      showCreatedBy
                      canRevoke
                      revoke={(id) => keeperApi.me.operators.revokeJwt(op.aid, id)}
                      formatError={prettyOwnedError}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {q.data && q.data.total > PAGE ? (
        <Pager offset={q.data.offset} limit={q.data.limit} total={q.data.total} shown={items.length} onChange={setOffset} />
      ) : null}

      {issueFor ? (
        <IssueJwtModal
          open
          aid={issueFor}
          issue={(body) => keeperApi.me.operators.issueJwt(issueFor, body)}
          defaultPreset="90d"
          formatError={prettyOwnedError}
          invalidateKeys={[jwtsKey(issueFor)]}
          onClose={() => setIssueFor(null)}
        />
      ) : null}
    </section>
  );
}
