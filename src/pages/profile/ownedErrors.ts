import { ApiError } from '../../api/client';
import i18n from '../../i18n';

// Refusals of the owner routes (/v1/me/operators/...). Ownership alone is not
// enough: the owner's own permissions must cover the operator's, and the request
// must not come with a personal token.
export function prettyOwnedError(err: unknown): string {
  const t = i18n.t.bind(i18n);
  if (err instanceof ApiError) {
    if (err.status === 403 && err.type.endsWith('/owner-lacks-permissions')) {
      return t('profile:ownedLacksPermissions', { detail: err.detail || err.message });
    }
    if (err.status === 403 && err.type.endsWith('/personal-jwt-from-personal')) {
      return t('profile:ownedFromPersonal');
    }
    return t('errors:generic', { status: err.status, detail: err.detail || err.message });
  }
  return String(err);
}
