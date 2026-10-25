import i18n from '../../i18n';
import { ApiError, NetworkError } from '../../api/client';
import { LoginSupersededError, SessionNotKeptError } from '../../hooks/useAuth';

// The message a refused login shows. A 401 says only that the credentials were
// refused — never whether the AID exists or which half was wrong (the Keeper
// answers every credential refusal with the same 401, and so does this).
// forbiddenKey, when given, is what a plain 403 shows (LDAP: the user signed
// in but no group of theirs maps to a role). A typed 403 — provisioning off
// for the method — keeps Keeper's own message.
export function loginErrorMessage(err: unknown, rejectedKey: string, forbiddenKey?: string): string {
  const t = i18n.t.bind(i18n);
  if (err instanceof SessionNotKeptError) return t('admin:loginErrSessionNotKept');
  if (err instanceof LoginSupersededError) return t('admin:loginErrSuperseded');
  if (err instanceof ApiError) {
    if (err.status === 401) return t(rejectedKey);
    if (err.status === 403 && forbiddenKey && err.type.endsWith('/forbidden')) return t(forbiddenKey);
    if (err.status === 429) return t('admin:loginErrThrottled');
    return `${t('admin:loginErrKeeperPrefix')} ${err.message}`;
  }
  if (err instanceof NetworkError) return t('admin:loginErrNetwork');
  return err instanceof Error ? err.message : t('admin:loginErrUnknown');
}
