import { ApiError } from '../../api/client';
import i18n from '../../i18n';

// Расшифровка серверной 409 «would-lock-out-cluster» / «role-builtin»
// в человеческое сообщение. Бэкенд возвращает problem+json (ADR-014).
// Локализация через глобальный i18n-инстанс (helper — pure-функция, не hook).
export function prettyRbacError(err: unknown): string {
  const t = i18n.t.bind(i18n);
  if (err instanceof ApiError) {
    if (err.status === 409) {
      const ty = (err.type || '').toLowerCase();
      const d = (err.detail || '').toLowerCase();
      if (ty.includes('lock-out') || d.includes('lock') || d.includes('admin')) {
        return t('errors:selfLockout');
      }
      if (ty.includes('builtin') || d.includes('builtin')) {
        return t('errors:builtinRole');
      }
      if (ty.includes('already-exists') || d.includes('already')) {
        return t('errors:roleAlreadyExists');
      }
      return t('errors:conflict', { detail: err.detail || err.message });
    }
    if (err.status === 404) return t('errors:notFoundRoleOrOperator');
    if (err.status === 403) return t('errors:forbidden');
    if (err.status === 422) return t('errors:validation', { detail: err.detail || err.message });
    return t('errors:generic', { status: err.status, detail: err.detail || err.message });
  }
  return String(err);
}
