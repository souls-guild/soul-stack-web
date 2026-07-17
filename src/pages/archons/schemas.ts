// Zod schema for the Archon creation form.
// AID_PATTERN — mirrors the backend ADR-014 amendment: relaxed to accept arbitrary
// LDAP/Keycloak uid and email-like identifiers. Sync with
// vendor/openapi/keeper.yaml on the next `gen:api`.
// auth_method in MVP is only `jwt` (ADR-014).
// roles — optional multi-select; the backend accepts the field as an
// addition to OperatorCreateRequest; roles are validated server-side (422
// validation-failed/unknown role).

import { z } from 'zod';

// ^[a-z0-9][a-z0-9._@-]{1,127}$ — lowercase ASCII + digits + . _ @ -,
// starts with a letter/digit, length 2..128.
// Mirrors the backend ADR-014 amendment; sync with OpenAPI on the next gen:api.
export const AID_PATTERN = /^[a-z0-9][a-z0-9._@-]{1,127}$/;

export const createArchonSchema = z.object({
  aid: z.string().regex(AID_PATTERN, 'aid_pattern_error'),
  display_name: z.string().min(1, 'required field').max(128, 'maximum 128 characters'),
  auth_method: z.enum(['jwt']),
  roles: z.array(z.string()).optional().default([]),
});

export type CreateArchonFormValues = z.infer<typeof createArchonSchema>;
