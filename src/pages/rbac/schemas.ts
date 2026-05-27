// Zod-схемы для RBAC CRUD-форм. Регэкспы синхронизированы с openapi.yaml
// (RoleCreateRequest.name kebab-case, RolePermissionsUpdateRequest, permission
// rbac.ParsePermission на сервере; здесь — мягкий клиентский фильтр, серверная
// валидация остаётся источником правды — 422 покажем как server-error).

import { z } from 'zod';

const ROLE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// permission-строка: "*", "namespace.*", "namespace.verb".
// Минимальный фильтр — пустую строку и пробелы не пускаем. Битый permission
// поймает сервер (422 validation-failed), мы его покажем как-есть.
const PERMISSION = /^[A-Za-z0-9._*-]+$/;

export const roleCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'обязательное поле')
    .regex(ROLE_NAME, 'kebab-case: ^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  description: z.string().trim().max(500, 'максимум 500 символов'),
  permissions: z.array(z.string().regex(PERMISSION, 'недопустимые символы')),
});

export type RoleCreateFormValues = z.infer<typeof roleCreateSchema>;

export const editPermissionsSchema = z.object({
  permissions: z.array(z.string().regex(PERMISSION, 'недопустимые символы')),
});

export type EditPermissionsFormValues = z.infer<typeof editPermissionsSchema>;

export function validatePermission(token: string): string | null {
  if (!PERMISSION.test(token)) return 'формат: namespace.verb или namespace.* или *';
  return null;
}
