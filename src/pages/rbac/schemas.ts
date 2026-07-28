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

// parentRole — the role this one derives from (ADR-078). REQUIRED on creation: every role
// is carved out of one that already exists, so that its ceiling is always some other
// role's, never an unbounded set assembled by hand.
// defaultScope — the role's own scope, which is the attenuating DELTA (the parent's scope
// is conjoined server-side). Shaped by the builder, so the client only guards the name
// pattern; the server validates the expression (422).
const PARENT_ROLE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// Messages — i18n keys in namespace `admin`; rendered via t(fieldError.message).
export const roleCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'admin:rbacErrRoleNameRequired')
    .regex(ROLE_NAME, 'admin:rbacErrRoleNamePattern'),
  description: z.string().trim().max(500, 'admin:rbacErrDescriptionMax'),
  permissions: z.array(z.string().regex(PERMISSION, 'admin:rbacErrPermissionChars')),
  parentRole: z
    .string()
    .trim()
    .min(1, 'admin:rbacErrParentRequired')
    .regex(PARENT_ROLE, 'admin:rbacErrRoleNamePattern'),
  defaultScope: z.string(),
});

export type RoleCreateFormValues = z.infer<typeof roleCreateSchema>;

export const editPermissionsSchema = z.object({
  permissions: z.array(z.string().regex(PERMISSION, 'admin:rbacErrPermissionChars')),
  defaultScope: z.string(),
});

export type EditPermissionsFormValues = z.infer<typeof editPermissionsSchema>;
