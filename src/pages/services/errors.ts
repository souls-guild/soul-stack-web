import { ApiError } from '../../api/client';
import i18n from '../../i18n';

// Decodes server problem+json into a human-readable message for Service forms
// (register / update / deregister). Backend — keeper openapi /v1/services.
// Localization via the global i18n instance (helper is a pure function, not a hook).
export function prettyServiceError(err: unknown): string {
  const t = i18n.t.bind(i18n);
  if (err instanceof ApiError) {
    const d = (err.detail || '').toLowerCase();
    if (err.status === 409) {
      return t('errors:svcAlreadyExists');
    }
    if (err.status === 422) {
      return t('errors:svcInvalid', { detail: err.detail || t('errors:svcInvalidDefault') });
    }
    if (err.status === 403) {
      return t('errors:svcForbidden');
    }
    if (err.status === 404) {
      if (d.includes('operator') || d.includes('aid')) {
        return t('errors:svcCreatorMissing');
      }
      return t('errors:svcNotFound');
    }
    if (err.status === 400) {
      return t('errors:svcBadRequest', { detail: err.detail || err.message });
    }
    return t('errors:generic', { status: err.status, detail: err.detail || err.message });
  }
  return String(err);
}
