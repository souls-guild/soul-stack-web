// Zod-схемы для RBAC CRUD-форм. Регэкспы синхронизированы с openapi.yaml
// (RoleCreateRequest.name kebab-case, RolePermissionsUpdateRequest, permission
// rbac.ParsePermission на сервере; здесь — мягкий клиентский фильтр, серверная
// валидация остаётся источником правды — 422 покажем как server-error).

import { z } from 'zod';

const ROLE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// permission-строка: "*", "namespace.*", "namespace.verb",
// "namespace.verb on key=value", "namespace.verb on key=v1,v2".
// Минимальный фильтр — пустую строку и пробелы не пускаем. Битый permission
// поймает сервер (422 validation-failed), мы его покажем как-есть.
const PERMISSION = /^[A-Za-z0-9._*-]+( on [a-z]+=\S+)?$/;

// Сообщения — i18n-ключи namespace `admin`; рендер через t(fieldError.message).
export const roleCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'admin:rbacErrRoleNameRequired')
    .regex(ROLE_NAME, 'admin:rbacErrRoleNamePattern'),
  description: z.string().trim().max(500, 'admin:rbacErrDescriptionMax'),
  permissions: z.array(z.string().regex(PERMISSION, 'admin:rbacErrPermissionChars')),
});

export type RoleCreateFormValues = z.infer<typeof roleCreateSchema>;

export const editPermissionsSchema = z.object({
  permissions: z.array(z.string().regex(PERMISSION, 'admin:rbacErrPermissionChars')),
});

export type EditPermissionsFormValues = z.infer<typeof editPermissionsSchema>;
