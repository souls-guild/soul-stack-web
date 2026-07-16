import { ApiError } from '../../api/client';
import i18n from '../../i18n';
import { plaintextDisabledMessage } from '../../components/input/secretMode';

// Decodes problem+json for the Provider form (create). Localization — global
// i18n instance (helper — pure function, not a hook).
export function prettyProviderError(err: unknown): string {
  const t = i18n.t.bind(i18n);
  // Special dual-mode case: accepting a plaintext secret value is disabled on the server.
  const plaintext = plaintextDisabledMessage(err);
  if (plaintext) return plaintext;
  if (err instanceof ApiError) {
    if (err.status === 409) return t('providers:errorNameTaken');
    if (err.status === 403) return t('providers:errorForbidden');
    if (err.status === 422) return t('errors:validation', { detail: err.detail || err.message });
    if (err.status === 400) return t('errors:generic', { status: 400, detail: err.detail || err.message });
    return t('errors:generic', { status: err.status, detail: err.detail || err.message });
  }
  return String(err);
}
