// Zod-схемы для Souls-модалок (Issue Token, Coven Assignment).
//
// Coven-форма: lowercase kebab-case (openapi.yaml SoulCovenAssignRequest.labels[].pattern).
// TTL: min 60s — нижняя граница bootstrap-токена, верхняя — без ограничений в API
// (по умолчанию 3600s, документация Keeper не вводит hard-cap на стороне OpenAPI).

import { z } from 'zod';

// Coven-метка по ADR-008: lowercase, цифры, дефис-разделитель, ≤ 63 символов.
export const COVEN_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export const covenLabelSchema = z
  .string()
  .min(1, 'souls:zodLabelRequired')
  .max(63, 'souls:zodLabelMaxLen')
  .regex(COVEN_PATTERN, 'souls:zodLabelPattern');

export const issueTokenSchema = z.object({
  ttl_seconds: z
    .number({ invalid_type_error: 'souls:zodTtlType' })
    .int('souls:zodTtlInt')
    .min(60, 'souls:zodTtlMin')
    .default(3600),
  force: z.boolean().default(false),
});
export type IssueTokenInput = z.infer<typeof issueTokenSchema>;

// Bulk coven-assign: append/remove → одна label; replace → набор labels.
// XOR-форма проверяется на уровне UI (radio mode → разные поля).
export const bulkCovenAssignSchema = z
  .object({
    mode: z.enum(['append', 'remove', 'replace']),
    label: z.string().optional(),
    labels: z.array(covenLabelSchema).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'replace') {
      // labels допускает пустой массив = «снять все»; UI это понимает.
      if (v.labels === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['labels'],
          message: 'souls:zodReplaceLabelsRequired',
        });
      }
    } else {
      if (!v.label || v.label.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['label'],
          message: 'souls:zodAppendRemoveLabel',
        });
        return;
      }
      if (!COVEN_PATTERN.test(v.label)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['label'],
          message: 'souls:zodLabelPattern',
        });
      }
    }
  });
export type BulkCovenAssignInput = z.infer<typeof bulkCovenAssignSchema>;
