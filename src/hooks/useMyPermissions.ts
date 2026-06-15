import { useQuery } from '@tanstack/react-query';
import { keeperApi } from '../api/keeper';

/**
 * Хук для получения эффективных прав текущего Архонта (GET /v1/me/permissions).
 *
 * wildcard=true (cluster-admin) → hasPermission() возвращает true для любого права.
 * Иначе проверяем наличие совпадения resource+action (без scope-сравнения — UI
 * использует hasPermission только для show/hide кнопок, не для авторизации).
 *
 * Пока данные грузятся — hasPermission возвращает true (optimistic), чтобы кнопки
 * не мигали при инициализации. Если fetch упал (403/500) — аналогично возвращаем
 * true (graceful; backend даст 403 при фактическом вызове).
 */
export function useMyPermissions() {
  const q = useQuery({
    queryKey: ['me.permissions'],
    queryFn: () => keeperApi.permissions.listMy(),
    staleTime: 60_000,
    retry: false,
  });

  function hasPermission(permission: string): boolean {
    // Пока грузим или ошибка — показываем кнопки (optimistic).
    if (!q.data) return true;

    const perms = q.data.permissions ?? [];
    // Cluster-admin: wildcard=true → всё разрешено.
    if (perms.some((p) => p.wildcard)) return true;

    // Парсим "resource.action" (формат из permission-каталога: synod.create и т.п.)
    const dot = permission.indexOf('.');
    if (dot === -1) return false;
    const resource = permission.slice(0, dot);
    const action = permission.slice(dot + 1);

    return perms.some(
      (p) =>
        p.resource === resource &&
        (p.action === action || p.action === '*'),
    );
  }

  return { hasPermission, isLoading: q.isLoading };
}
