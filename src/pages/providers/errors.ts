import { ApiError } from '../../api/client';
import i18n from '../../i18n';
import { plaintextDisabledMessage } from '../../components/input/secretMode';

// Расшифровка problem+json для Provider-формы (create). Локализация — глобальный
// i18n-инстанс (helper — pure-функция, не hook).
export function prettyProviderError(err: unknown): string {
  const t = i18n.t.bind(i18n);
  // Специальный случай dual-mode: приём значения секрета выключен на сервере.
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
