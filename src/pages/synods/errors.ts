import { ApiError } from '../../api/client';
import i18n from '../../i18n';

/**
 * Расшифровка серверных ошибок Synod-операций в человеческое сообщение.
 * Коды: synod-already-exists / synod-builtin / would-lock-out-cluster / not-found.
 * 403 subset-check: сервер отклонил grant-role/add-operator (privilege escalation).
 */
export function prettySynodError(err: unknown): string {
  const t = i18n.t.bind(i18n);
  if (err instanceof ApiError) {
    if (err.status === 409) {
      const ty = (err.type || '').toLowerCase();
      const d = (err.detail || '').toLowerCase();
      if (ty.includes('lock-out') || d.includes('lock') || d.includes('admin')) {
        return t('errors:synodLockout');
      }
      if (ty.includes('builtin') || d.includes('builtin')) {
        return t('errors:synodBuiltin');
      }
      if (ty.includes('already-exists') || d.includes('already')) {
        return t('errors:synodAlreadyExists');
      }
      return t('errors:conflict', { detail: err.detail || err.message });
    }
    if (err.status === 403) {
      const ty = (err.type || '').toLowerCase();
      if (ty.includes('subset') || (err.detail || '').toLowerCase().includes('subset')) {
        return t('errors:synodSubsetDenied');
      }
      return t('errors:forbidden');
    }
    if (err.status === 404) return t('errors:synodNotFound');
    if (err.status === 422) return t('errors:validation', { detail: err.detail || err.message });
    return t('errors:generic', { status: err.status, detail: err.detail || err.message });
  }
  return String(err);
}
