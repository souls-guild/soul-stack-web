// Zod-схема формы создания Архонта.
// AID_PATTERN — зеркало backend ADR-014 amendment: ослаблен до произвольных
// LDAP/Keycloak uid и email-подобных идентификаторов. Синхронизировать с
// vendor/openapi/keeper.yaml при следующем `gen:api`.
// auth_method в MVP только `jwt` (ADR-014).
// roles — опциональный multi-select; backend принимает поле как
// дополнение к OperatorCreateRequest; роли проверяются сервером (422
// validation-failed/unknown role).

import { z } from 'zod';

// ^[a-z0-9][a-z0-9._@-]{1,127}$ — строчные ASCII + цифры + . _ @ -,
// старт с буквы/цифры, длина 2..128.
// Зеркало backend ADR-014 amendment; sync с OpenAPI при следующем gen:api.
export const AID_PATTERN = /^[a-z0-9][a-z0-9._@-]{1,127}$/;

export const createArchonSchema = z.object({
  aid: z.string().regex(AID_PATTERN, 'aid_pattern_error'),
  display_name: z.string().min(1, 'обязательное поле').max(128, 'максимум 128 символов'),
  auth_method: z.enum(['jwt']),
  roles: z.array(z.string()).optional().default([]),
});

export type CreateArchonFormValues = z.infer<typeof createArchonSchema>;
