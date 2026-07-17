import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { tokenStore, type OperatorIdentity } from '../api/tokenStore';
import { AuthContext, type AuthContextValue } from './useAuth';
import { keeperApi } from '../api/keeper';
import { ApiError } from '../api/client';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<OperatorIdentity | null>(() => tokenStore.identity());
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  // On startup, if a token exists - try a lightweight request as verify.
  // If 401 - the token has already been cleared by the interceptor, update UI-state.
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    setIsVerifying(true);
    keeperApi
      .ping()
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          if (!cancelled) setIdentity(null);
        }
      })
      .finally(() => {
        if (!cancelled) setIsVerifying(false);
      });
    return () => {
      cancelled = true;
    };
    // identity is compared by reference - but we only re-run verify
    // when the fact "identity exists" itself has changed (after login/logout).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.aid]);

  const loginWithToken = useCallback(async (token: string) => {
    const trimmed = token.trim();
    if (!trimmed) throw new Error('empty token');
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

  const logout = useCallback(async () => {
    tokenStore.clear();
    setIdentity(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      identity,
      isAuthenticated: identity !== null,
      isVerifying,
      loginWithToken,
      logout,
    }),
    [identity, isVerifying, loginWithToken, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
