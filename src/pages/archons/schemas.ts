// Zod-схема формы создания Архонта. AID — синхронен с openapi pattern
// `^archon-[a-z0-9-]{1,62}$`; auth_method в MVP только `jwt` (ADR-014).
// roles — опциональный multi-select; backend принимает поле как
// дополнение к OperatorCreateRequest; роли проверяются сервером (422
// validation-failed/unknown role).

import { z } from 'zod';

export const AID_PATTERN = /^archon-[a-z0-9-]{1,62}$/;

export const createArchonSchema = z.object({
  aid: z.string().regex(AID_PATTERN, 'pattern ^archon-[a-z0-9-]{1,62}$'),
  display_name: z.string().min(1, 'обязательное поле').max(128, 'максимум 128 символов'),
  auth_method: z.enum(['jwt']),
  roles: z.array(z.string()).optional().default([]),
});

export type CreateArchonFormValues = z.infer<typeof createArchonSchema>;
