import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { keeperApi, type AuthMethodsReply } from '../api/keeper';
import { PasswordLoginForm } from './login/PasswordLoginForm';
import { TokenLoginForm } from './login/TokenLoginForm';
import styles from './Login.module.css';
import common from './common.module.css';

interface LocationState {
  from?: { pathname?: string; search?: string; hash?: string };
}

// Where an authenticated operator belongs. ProtectedRoute hands over the whole
// location it interrupted, and the query string is where the operator's filter
// lives — coming back to the bare path loses their work and reads as "it did
// not return me at all".
//
// Both the post-login navigation and the already-authenticated redirect below
// go through this. They used to disagree, and the redirect — which ignored the
// origin entirely — won the race after login, so nobody was ever returned. The
// fix is not to win that race but to remove it: one destination, one rule.
function returnTo(state: unknown): string {
  const from = (state as LocationState | undefined)?.from;
  if (!from?.pathname) return '/incarnations';
  return `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`;
}

// A way to log in. The form shows the ones GET /auth/methods offers, in this
// order; the first is the default. `token` (pasting a JWT) always exists.
type LoginMethod = 'local' | 'token';

const METHOD_LABEL: Record<LoginMethod, string> = {
  local: 'admin:loginMethodLocal',
  token: 'admin:loginMethodToken',
};

function offeredMethods(methods: AuthMethodsReply | undefined): LoginMethod[] {
  const out: LoginMethod[] = [];
  if (methods?.local) out.push('local');
  out.push('token');
  return out;
}

// How long the page waits for /auth/methods before showing the token form
// anyway: a Keeper that hangs must not leave the page with no form at all.
const METHODS_WAIT_MS = 3_000;

export function Login() {
  const { t } = useTranslation();
  const { loginWithPassword, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [chosen, setChosen] = useState<LoginMethod | null>(null);
  const [waitedOut, setWaitedOut] = useState(false);
  const [tokenTyped, setTokenTyped] = useState(false);

  // Failing → only the token form, the page as it always was. A short wait
  // first, so a form that would be replaced at once is not shown; a hang past
  // it gets the token form, and a later answer does not take it away from a
  // token being pasted.
  const methodsQ = useQuery({
    queryKey: ['auth.methods'],
    queryFn: () => keeperApi.auth.methods(),
    staleTime: 60_000,
    retry: false,
  });
  useEffect(() => {
    const timer = setTimeout(() => setWaitedOut(true), METHODS_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  const waiting = methodsQ.isPending && !waitedOut;
  const offered = offeredMethods(methodsQ.data);
  const fallback: LoginMethod = tokenTyped ? 'token' : offered[0];
  const method = chosen && offered.includes(chosen) ? chosen : fallback;

  if (isAuthenticated) {
    return <Navigate to={returnTo(location.state)} replace />;
  }

  const done = () => navigate(returnTo(location.state), { replace: true });

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <div className={styles.mark}>SS</div>
          <div>
            <h1 className={styles.title}>Soul Stack</h1>
            <p className={styles.subtitle}>{t('admin:loginSubtitle')}</p>
          </div>
        </div>
        {waiting ? (
          <p className={styles.hint} data-testid="login-methods-loading">{t('admin:loginMethodsLoading')}</p>
        ) : null}
        {!waiting && offered.length > 1 ? (
          <div className={common.tabs} role="tablist" aria-label={t('admin:loginMethodAria')}>
            {offered.map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={method === m}
                className={`${common.tab} ${method === m ? common.tabActive : ''}`}
                data-testid={`login-method-${m}`}
                onClick={() => setChosen(m)}
              >
                {t(METHOD_LABEL[m])}
              </button>
            ))}
          </div>
        ) : null}
        {waiting ? null : method === 'local' ? (
          <PasswordLoginForm
            submit={loginWithPassword}
            onSuccess={done}
            loginLabel={t('common:colAid')}
            hint={t('admin:loginLocalHint')}
            rejectedKey="admin:loginErrBadCredentials"
            testId="login-local"
          />
        ) : (
          <TokenLoginForm onSuccess={done} onTyped={setTokenTyped} />
        )}
      </div>
    </div>
  );
}
