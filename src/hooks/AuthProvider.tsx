import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { tokenStore, type OperatorIdentity } from '../api/tokenStore';
import { AuthContext, LoginSupersededError, SessionNotKeptError, type AuthContextValue } from './useAuth';
import { keeperApi } from '../api/keeper';
import { ApiError, setSessionHooks } from '../api/client';
import { normalizeLoginAID } from '../api/loginAID';

// The startup restore stops holding the page blank after this. Its exchange is
// aborted at the same moment (EXCHANGE_TIMEOUT_MS), so in a browser no later
// answer arrives: the login form shows and the session marker stays for a
// reload to try again. The wait guards an exchange that ignores the abort;
// a late answer of one would still log the tab in.
const RESTORE_WAIT_MS = 10_000;
// An exchange that has not answered by then is abandoned: every request it
// holds gets its original 401 back instead of waiting on a hung Keeper.
const EXCHANGE_TIMEOUT_MS = 10_000;
// How long a log-out waits for Keeper to end the session — an exchange and
// the revoke — before forgetting it here regardless.
const LOGOUT_TIMEOUT_MS = 10_000;

function exchangeWithTimeout() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EXCHANGE_TIMEOUT_MS);
  return keeperApi.auth.exchange(ctrl.signal).finally(() => clearTimeout(timer));
}

// A cookie session (a password, LDAP or SSO login) has no refresh timer: its Bearer is
// exchanged again when Keeper refuses it (client.ts → refresh below), and
// before a raw channel opens once half its lifetime has passed on this
// browser's clock — elapsed time only, never compared with Keeper's clock
// (tokenStore.sessionBearerFresh). Every exchange stores
// its Bearer only while the session id it started under is still the stored
// one; a logout, a pasted token or another login (this tab or another) changes
// the id and the late answer is dropped.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<OperatorIdentity | null>(() => tokenStore.identity());
  // A session with no Bearer in hand is restored by one exchange; until it
  // answers the app is "verifying", not "logged out".
  const [isVerifying, setIsVerifying] = useState<boolean>(
    () => !tokenStore.identity() && tokenStore.isSession(),
  );
  const pingSeq = useRef(0);

  const endSession = useCallback(() => {
    tokenStore.clear();
    tokenStore.clearSession();
    setIsVerifying(false);
    setIdentity(null);
  }, []);

  // exchangeFor trades the session cookie for a Bearer on behalf of session id
  // sid. Resolves with the identity stored, or null when sid is no longer the
  // current session (the answer is dropped). A Bearer for another AID than the
  // session's means another login replaced the cookie: the session ends rather
  // than this tab quietly becoming that operator. Rejects with the exchange
  // error.
  const exchangeFor = useCallback(async (sid: string): Promise<OperatorIdentity | null> => {
    const reply = await exchangeWithTimeout();
    if (tokenStore.sessionId() !== sid) return null;
    if (tokenStore.subjectOf(reply.token) !== tokenStore.sessionAID()) {
      endSession();
      return null;
    }
    tokenStore.setSessionBearer(reply.token);
    const next = tokenStore.identity();
    setIdentity(next);
    return next;
  }, [endSession]);

  // The client's hooks for a session Bearer Keeper refused.
  useEffect(() => {
    setSessionHooks({
      refresh: async () => {
        const sid = tokenStore.sessionId();
        if (!sid) return false;
        try {
          return (await exchangeFor(sid)) !== null;
        } catch (err) {
          // Only Keeper saying the session is gone ends it. An outage, a
          // restart or a throttle leaves it for the next request to try again.
          if (err instanceof ApiError && err.status === 401 && tokenStore.sessionId() === sid) endSession();
          return false;
        }
      },
      end: endSession,
    });
    return () => setSessionHooks(null);
  }, [exchangeFor, endSession]);

  // Another tab's login, logout, pasted token or exchange: show what is stored now.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!tokenStore.ownsKey(e.key)) return;
      setIdentity(tokenStore.identity());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Startup restore: a session marker with no Bearer to go with it.
  useEffect(() => {
    const sid = tokenStore.sessionId();
    if (identity || !sid) return;
    let cancelled = false;
    const giveUp = setTimeout(() => {
      if (!cancelled) setIsVerifying(false);
    }, RESTORE_WAIT_MS);
    exchangeFor(sid)
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401 && tokenStore.sessionId() === sid) endSession();
      })
      .finally(() => {
        clearTimeout(giveUp);
        if (!cancelled) setIsVerifying(false);
      });
    return () => {
      cancelled = true;
      clearTimeout(giveUp);
    };
    // Mount only: a later loss of identity is a logout, not a restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On startup, if a token exists - try a lightweight request as verify. A
  // pasted token refused with 401 is already cleared by the client; a session
  // Bearer was exchanged and retried there, and the session ended if Keeper
  // refused that. Only the latest ping settles isVerifying: a ping abandoned by
  // a logout must still clear it, or ProtectedRoute renders nothing forever.
  useEffect(() => {
    if (!identity) return;
    const seq = ++pingSeq.current;
    setIsVerifying(true);
    keeperApi
      .ping()
      .catch((err) => {
        // What is stored now: the client cleared the refused token, unless
        // another tab pasted another one meanwhile.
        if (seq === pingSeq.current && err instanceof ApiError && err.status === 401 && !tokenStore.isSession()) {
          setIdentity(tokenStore.identity());
        }
      })
      .finally(() => {
        if (seq === pingSeq.current) setIsVerifying(false);
      });
    // identity is compared by reference - but we only re-run verify
    // when the fact "identity exists" itself has changed (after login/logout).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.aid]);

  const loginWithToken = useCallback(async (token: string) => {
    const trimmed = token.trim();
    if (!trimmed) throw new Error('empty token');
    tokenStore.clearSession();
    tokenStore.set(trimmed);
    try {
      await keeperApi.ping();
    } catch (err) {
      tokenStore.clear();
      throw err;
    }
    const next = tokenStore.identity();
    setIdentity(next);
  }, []);

  // A login that sets the session cookie, then the exchange that makes it this
  // browser's session. If the session of this browser changed while it was in
  // flight (another tab logged out or in, a token was pasted), or — when the
  // login names the AID (expectAID) — the cookie was replaced by another tab's
  // login before the exchange read it, the result is dropped and the caller
  // told so.
  const startCookieSession = useCallback(
    async (method: string, login: () => Promise<void>, expectAID: string | null) => {
      const before = tokenStore.sessionId();
      await login();
      let token: string;
      try {
        token = (await exchangeWithTimeout()).token;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) throw new SessionNotKeptError();
        throw err;
      }
      if (tokenStore.sessionId() !== before || (expectAID !== null && tokenStore.subjectOf(token) !== expectAID)) {
        throw new LoginSupersededError();
      }
      tokenStore.startSession(token, method);
      setIdentity(tokenStore.identity());
    },
    [],
  );

  const loginWithPassword = useCallback(
    (aid: string, password: string) =>
      startCookieSession('local', () => keeperApi.auth.localLogin(aid, password), normalizeLoginAID(aid)),
    [startCookieSession],
  );

  const loginWithLDAP = useCallback(
    (username: string, password: string) =>
      startCookieSession('ldap', () => keeperApi.auth.ldapLogin(username, password), null),
    [startCookieSession],
  );

  const completeSSO = useCallback(() => startCookieSession('oidc', async () => {}, null), [startCookieSession]);

  // A session's cookie is a credential for its whole lifetime: forgetting the
  // Bearer here would leave it working. A stale Bearer is exchanged first, so
  // the revoke does not lean on the client's retry — a sign-out that gives up
  // ends the session here, and the retry would no longer be sent. Keeper
  // unreachable or slow — the session is forgotten here all the same.
  const logout = useCallback(async () => {
    const sid = tokenStore.sessionId();
    const jwtId = sid ? (tokenStore.identity()?.jwtId ?? null) : null;
    if (sid && jwtId) {
      const revoke = (async () => {
        if (!tokenStore.sessionBearerFresh()) await exchangeFor(sid);
        await keeperApi.me.jwts.revoke(jwtId);
      })().catch(() => undefined);
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([revoke, new Promise<void>((resolve) => (timer = setTimeout(resolve, LOGOUT_TIMEOUT_MS)))]);
      clearTimeout(timer);
    }
    endSession();
  }, [endSession, exchangeFor]);

  const value = useMemo<AuthContextValue>(
    () => ({
      identity,
      isAuthenticated: identity !== null,
      isVerifying,
      loginWithToken,
      loginWithPassword,
      loginWithLDAP,
      completeSSO,
      logout,
      forgetSession: endSession,
    }),
    [identity, isVerifying, loginWithToken, loginWithPassword, loginWithLDAP, completeSSO, logout, endSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
