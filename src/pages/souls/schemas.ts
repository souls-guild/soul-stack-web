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
  .min(1, 'метка обязательна')
  .max(63, 'не длиннее 63 символов')
  .regex(COVEN_PATTERN, 'lowercase, цифры, дефис-разделитель');

export const issueTokenSchema = z.object({
  ttl_seconds: z
    .number({ invalid_type_error: 'число секунд' })
    .int('целое число')
    .min(60, 'минимум 60 секунд')
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
          message: 'для replace задайте набор меток (можно пустой)',
        });
      }
    } else {
      if (!v.label || v.label.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['label'],
          message: 'для append/remove обязательна одна метка',
        });
        return;
      }
      if (!COVEN_PATTERN.test(v.label)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['label'],
          message: 'lowercase, цифры, дефис-разделитель',
        });
      }
    }
  });
export type BulkCovenAssignInput = z.infer<typeof bulkCovenAssignSchema>;
