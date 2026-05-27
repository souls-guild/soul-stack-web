import { ApiError } from '../../api/client';

// Расшифровка серверной 409 «would-lock-out-cluster» / «role-builtin»
// в человеческое сообщение. Бэкенд возвращает problem+json (ADR-014).
export function prettyRbacError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      const t = (err.type || '').toLowerCase();
      const d = (err.detail || '').toLowerCase();
      if (t.includes('lock-out') || d.includes('lock') || d.includes('admin')) {
        return (
          'Нельзя оставить кластер без `*`-админа (self-lockout-защита, ADR-013/014). ' +
          'Сначала назначьте другого оператора с cluster-admin / *.'
        );
      }
      if (t.includes('builtin') || d.includes('builtin')) {
        return 'Builtin-роль (например cluster-admin) нельзя редактировать или удалить.';
      }
      if (t.includes('already-exists') || d.includes('already')) {
        return 'Роль с таким именем уже существует.';
      }
      return `Конфликт: ${err.detail || err.message}`;
    }
    if (err.status === 404) return 'Не найдено (роль или оператор).';
    if (err.status === 403) return 'Недостаточно прав для операции.';
    if (err.status === 422) return `Валидация: ${err.detail || err.message}`;
    return `Ошибка ${err.status}: ${err.detail || err.message}`;
  }
  return String(err);
}
