import { ApiError } from '../../api/client';

// Расшифровка серверных problem+json в человеческое сообщение для Service-форм
// (register / update / deregister). Backend — keeper openapi /v1/services.
export function prettyServiceError(err: unknown): string {
  if (err instanceof ApiError) {
    const d = (err.detail || '').toLowerCase();
    if (err.status === 409) {
      return 'Service с таким именем уже зарегистрирован. Выберите другое имя.';
    }
    if (err.status === 422) {
      return `Невалидные данные: ${err.detail || 'проверьте имя и git-URL'}.`;
    }
    if (err.status === 403) {
      return 'Недостаточно прав на эту операцию (нужен service.register / service.update / service.deregister).';
    }
    if (err.status === 404) {
      if (d.includes('operator') || d.includes('aid')) {
        return 'AID создателя отсутствует в реестре operators.';
      }
      return 'Service не найден.';
    }
    if (err.status === 400) {
      return `Ошибка запроса: ${err.detail || err.message}.`;
    }
    return `Ошибка ${err.status}: ${err.detail || err.message}`;
  }
  return String(err);
}
