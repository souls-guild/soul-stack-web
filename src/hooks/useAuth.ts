import { createContext, useContext } from 'react';
import type { OperatorIdentity } from '../api/tokenStore';

export interface AuthContextValue {
  identity: OperatorIdentity | null;
  isAuthenticated: boolean;
  isVerifying: boolean;
  loginWithToken: (token: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth должен использоваться внутри <AuthProvider>');
  return ctx;
}
