// Zod schemas for RBAC CRUD forms. Regexes synced with openapi.yaml
// (RoleCreateRequest.name kebab-case, RolePermissionsUpdateRequest, permission
// rbac.ParsePermission on the server; here — a soft client-side filter, server
// validation remains the source of truth — 422 is shown as a server-error).

import { z } from 'zod';

const ROLE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// permission string: "*", "namespace.*", "namespace.verb", or with a boolean scope
// "namespace.verb on <scope-expr>" (NIM-128) — the scope expression may contain
// spaces, parentheses, quotes and AND/OR, so the tail is left permissive. The server
// (rbac.ParsePermission) is the source of truth and returns 422 on a bad scope; we
// only reject an empty base here.
const PERMISSION = /^[A-Za-z0-9._*-]+( on .+)?$/;

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
