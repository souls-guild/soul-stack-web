import { createContext, useContext } from 'react';
import type { OperatorIdentity } from '../api/tokenStore';

// The password was accepted but the session cookie it set could not be
// exchanged: the browser did not keep or send it (a Secure cookie needs HTTPS
// or localhost). Not a credential refusal — the AID and password were right.
export class SessionNotKeptError extends Error {
  constructor() {
    super('the session cookie of the login was not kept by the browser');
    this.name = 'SessionNotKeptError';
  }
}

// The password was accepted, but while the login was in flight the session of
// this browser changed under it — another tab logged out, logged in, or a
// token was pasted. Its Bearer is dropped rather than overwrite that.
export class LoginSupersededError extends Error {
  constructor() {
    super('another tab changed the login while this one was in flight');
    this.name = 'LoginSupersededError';
  }
}

export interface AuthContextValue {
  identity: OperatorIdentity | null;
  isAuthenticated: boolean;
  isVerifying: boolean;
  loginWithToken: (token: string) => Promise<void>;
  // A local-password login: the session cookie is exchanged for a Bearer, and
  // exchanged again whenever Keeper refuses that Bearer (client.ts). Rejects
  // with the ApiError or NetworkError of the login (401 bad credentials, 429
  // locked out), SessionNotKeptError when the exchange right after it is
  // refused, LoginSupersededError when another tab changed the login meanwhile,
  // or the error of the exchange. Never resolves without logging in.
  loginWithPassword: (aid: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
