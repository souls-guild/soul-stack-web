import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LoginSupersededError, SessionNotKeptError, useAuth } from '../hooks/useAuth';
import { keeperApi, type AuthMethodsReply } from '../api/keeper';
import { tokenStore } from '../api/tokenStore';
import { Button } from '../components/primitives';
import { PasswordLoginForm } from './login/PasswordLoginForm';
import { TokenLoginForm } from './login/TokenLoginForm';
import { loginErrorMessage } from './login/loginErrorMessage';
import styles from './Login.module.css';
import common from './common.module.css';

interface LocationState {
  from?: { pathname?: string; search?: string; hash?: string };
}

const DEFAULT_RETURN = '/incarnations';

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
  if (!from?.pathname) return DEFAULT_RETURN;
  return `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`;
}

// The round trip through the IdP loses the router state, so the destination
// waits in sessionStorage — and its presence is what says this tab started
// the SSO sign-in: a landing link opened anywhere else exchanges nothing.
// Only an in-app path is taken back.
const SSO_RETURN_KEY = 'soul-stack.sso-return';

function readSsoReturn(): string | null {
  const stored = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(SSO_RETURN_KEY);
  if (stored === null) return null;
  return stored.startsWith('/') && !stored.startsWith('//') ? stored : DEFAULT_RETURN;
}

// A way to log in. The form shows the ones GET /auth/methods offers, in this
// order; the first is the default. `token` (pasting a JWT) always exists. OIDC
// is not a tab: it has no form, only the button under it.
type LoginMethod = 'local' | 'ldap' | 'token';

const METHOD_LABEL: Record<LoginMethod, string> = {
  local: 'admin:loginMethodLocal',
  ldap: 'admin:loginMethodLdap',
  token: 'admin:loginMethodToken',
};

function offeredMethods(methods: AuthMethodsReply | undefined): LoginMethod[] {
  const out: LoginMethod[] = [];
  if (methods?.local) out.push('local');
  if (methods?.ldap) out.push('ldap');
  out.push('token');
  return out;
}

// How long the page waits for /auth/methods before showing the token form
// anyway: a Keeper that hangs must not leave the page with no form at all.
const METHODS_WAIT_MS = 3_000;

export function Login() {
  const { t } = useTranslation();
  const { loginWithPassword, loginWithLDAP, completeSSO, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [chosen, setChosen] = useState<LoginMethod | null>(null);
  const [waitedOut, setWaitedOut] = useState(false);
  const [tokenTyped, setTokenTyped] = useState(false);
  const ssoLanding = new URLSearchParams(location.search).get('sso') === 'done';
  const [ssoReturn] = useState(() => (ssoLanding ? readSsoReturn() : null));
  const [ssoPending, setSsoPending] = useState(ssoReturn !== null && !isAuthenticated);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const ssoStarted = useRef(false);

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

  // Back from the IdP: the callback set the session cookie and sent the
  // browser here. Once per page, even when an effect runs twice, and never in
  // a tab already signed in — the landing does not switch who that is.
  useEffect(() => {
    // The form shown without a landing: an SSO sign-in this tab started was
    // abandoned at the IdP, and its marker must not vouch for a later landing.
    if (!ssoLanding) sessionStorage.removeItem(SSO_RETURN_KEY);
    // A landing that does not complete leaves its URL, so that going back
    // from a later SSO start abandoned at the IdP shows a plain /login, which
    // drops the marker. Not in a signed-in tab: that one is redirected.
    const leaveLanding = () => {
      if (!tokenStore.identity()) navigate('/login', { replace: true });
    };
    if (ssoLanding && ssoReturn === null && !isAuthenticated) leaveLanding();
    if (ssoReturn === null || ssoStarted.current) return;
    ssoStarted.current = true;
    sessionStorage.removeItem(SSO_RETURN_KEY);
    if (isAuthenticated) return;
    completeSSO()
      .then(() => navigate(ssoReturn, { replace: true }))
      .catch((err) => {
        // No cookie to exchange, or another tab's sign-in in between: the SSO
        // sign-in did not finish — no password was involved.
        const unfinished = err instanceof SessionNotKeptError || err instanceof LoginSupersededError;
        setSsoError(unfinished ? t('admin:loginErrSso') : loginErrorMessage(err, 'admin:loginErrSso'));
        setSsoPending(false);
        leaveLanding();
      });
    // Mount only: the landing is one page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const waiting = methodsQ.isPending && !waitedOut;
  const offered = offeredMethods(methodsQ.data);
  const fallback: LoginMethod = tokenTyped ? 'token' : offered[0];
  const method = chosen && offered.includes(chosen) ? chosen : fallback;
  const destination = ssoReturn ?? returnTo(location.state);

  if (isAuthenticated) {
    return <Navigate to={destination} replace />;
  }

  const done = () => navigate(destination, { replace: true });

  const startSSO = () => {
    sessionStorage.setItem(SSO_RETURN_KEY, returnTo(location.state));
    window.location.assign(keeperApi.auth.oidcLoginPath);
  };

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
        {ssoPending ? (
          <p className={styles.hint} data-testid="login-sso-pending">{t('admin:loginSsoPending')}</p>
        ) : null}
        {ssoError ? <div className={styles.error} data-testid="login-sso-error">{ssoError}</div> : null}
        {waiting && !ssoPending ? (
          <p className={styles.hint} data-testid="login-methods-loading">{t('admin:loginMethodsLoading')}</p>
        ) : null}
        {!waiting && !ssoPending && offered.length > 1 ? (
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
        {waiting || ssoPending ? null : method === 'local' ? (
          <PasswordLoginForm
            key="local"
            submit={loginWithPassword}
            onSuccess={done}
            loginLabel={t('common:colAid')}
            hint={t('admin:loginLocalHint')}
            rejectedKey="admin:loginErrBadCredentials"
            testId="login-local"
          />
        ) : method === 'ldap' ? (
          <PasswordLoginForm
            key="ldap"
            submit={loginWithLDAP}
            onSuccess={done}
            loginLabel={t('admin:loginLdapLogin')}
            hint={t('admin:loginLdapHint')}
            rejectedKey="admin:loginErrLdapRejected"
            forbiddenKey="admin:loginErrLdapNoRole"
            loginRequiredKey="admin:loginErrLdapLoginRequired"
            testId="login-ldap"
          />
        ) : (
          <TokenLoginForm onSuccess={done} onTyped={setTokenTyped} />
        )}
        {!waiting && !ssoPending && methodsQ.data?.oidc ? (
          <>
            <div className={styles.or}>{t('admin:loginOr')}</div>
            <Button type="button" onClick={startSSO} data-testid="login-sso">
              {t('admin:loginSso')}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
