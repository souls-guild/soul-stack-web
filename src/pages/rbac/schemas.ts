// Zod schemas for RBAC CRUD forms. Regexes synced with openapi.yaml
// (RoleCreateRequest.name kebab-case, RolePermissionsUpdateRequest, permission
// rbac.ParsePermission on the server; here — a soft client-side filter, server
// validation remains the source of truth — 422 is shown as a server-error).

import { z } from 'zod';

const ROLE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// permission string: "*", "namespace.*", "namespace.verb",
// "namespace.verb on key=value", "namespace.verb on key=v1,v2".
// Minimal filter — empty string and whitespace are rejected. A malformed permission
// will be caught by the server (422 validation-failed), we show it as-is.
const PERMISSION = /^[A-Za-z0-9._*-]+( on [a-z]+=\S+)?$/;

// Messages — i18n keys in namespace `admin`; rendered via t(fieldError.message).
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
