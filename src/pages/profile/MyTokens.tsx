// Profile → Tokens: the caller's own tokens (GET /v1/me/jwts) and a personal token
// issued to oneself (POST /v1/me/jwts). Sign-ins are left to their own section,
// so this list covers the other kinds. No permission is involved: the routes reach
// only the caller's rows.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { keeperApi, type OperatorJWTKind } from '../../api/keeper';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/primitives';
import { JwtList } from '../../components/JwtList';
import { IssueJwtModal } from './IssueJwtModal';
import styles from '../common.module.css';

const KINDS: OperatorJWTKind[] = ['personal', 'issued', 'bootstrap'];
const LIST_KEY = ['me.jwts'] as const;
const TERMS_KEY = ['me.jwts.terms'] as const;

export function MyTokens() {
  const { t } = useTranslation();
  const { identity, logout } = useAuth();
  const navigate = useNavigate();
  const [issueOpen, setIssueOpen] = useState(false);

  // What POST /v1/me/jwts would accept rides on the list reply; one row is enough.
  const terms = useQuery({
    queryKey: TERMS_KEY,
    queryFn: () => keeperApi.me.jwts.list({ kind: ['personal'], state: 'active', limit: 1 }),
  });
  const active = terms.data?.personal_active ?? 0;
  const limit = terms.data?.personal_limit ?? 0;
  const lastDay = terms.data?.personal_last_day ?? 0;
  const dailyLimit = terms.data?.personal_daily_limit ?? 0;
  const atLimit = Boolean(terms.data) && active >= limit;
  const atDailyLimit = Boolean(terms.data) && lastDay >= dailyLimit;
  // The daily limit first, as the server reports it: revoking does not lift it.
  const blocked = atDailyLimit ? t('profile:atDailyLimit', { limit: dailyLimit }) : atLimit ? t('profile:atLimit', { limit }) : null;

  return (
    <section className={styles.section} aria-label={t('profile:tabTokens')}>
      <h2 className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>{t('profile:myTokens')}</span>
        <span style={{ flex: 1 }} />
        {terms.data ? (
          <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }} data-testid="personal-count">
            {t('profile:personalCount', { active, limit })}
          </span>
        ) : null}
        <Button
          type="button"
          variant="primary"
          data-testid="issue-jwt-btn"
          disabled={!terms.data || blocked !== null}
          title={blocked ?? undefined}
          onClick={() => setIssueOpen(true)}
        >
          {t('profile:issueToken')}
        </Button>
      </h2>
      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {t('profile:tokensHint')}
      </p>
      {blocked ? (
        <div className={styles.errorBox} role="status" data-testid="personal-at-limit" style={{ marginBottom: 10 }}>
          {blocked}
        </div>
      ) : null}

      <JwtList
        queryKey={LIST_KEY}
        fetchPage={(q) => keeperApi.me.jwts.list(q)}
        kinds={KINDS}
        currentJwtId={identity?.jwtId}
        canRevoke
        revoke={(id) => keeperApi.me.jwts.revoke(id)}
        invalidateKeys={[TERMS_KEY]}
        onRevoked={(row) => {
          if (identity?.jwtId && row.jwt_id === identity.jwtId) {
            void logout().then(() => navigate('/login', { replace: true }));
          }
        }}
      />

      <IssueJwtModal
        open={issueOpen}
        ttlMaxSeconds={terms.data?.personal_ttl_max_seconds ?? 0}
        expiresBy={terms.data?.personal_expires_by}
        onClose={() => setIssueOpen(false)}
        invalidateKeys={[LIST_KEY, TERMS_KEY]}
      />
    </section>
  );
}
