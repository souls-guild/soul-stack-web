// Zod schemas for Souls modals (Issue Token, Coven Assignment).
//
// Coven form: lowercase kebab-case (openapi.yaml SoulCovenAssignRequest.labels[].pattern).
// TTL: min 60s -- lower bound of the bootstrap token, upper bound is unrestricted in the API
// (default 3600s, Keeper documentation does not introduce a hard-cap on the OpenAPI side).

import { z } from 'zod';

// Coven label per ADR-008: lowercase, digits, hyphen-separated, <= 63 characters.
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
    .min(60, 'souls:zodTtlMin'),
  force: z.boolean(),
});
export type IssueTokenInput = z.infer<typeof issueTokenSchema>;

// Bulk coven-assign: append/remove -> a single label; replace -> a set of labels.
// The XOR form is validated at the UI level (radio mode -> different fields).
export const bulkCovenAssignSchema = z
  .object({
    mode: z.enum(['append', 'remove', 'replace']),
    label: z.string().optional(),
    labels: z.array(covenLabelSchema).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'replace') {
      // labels allows an empty array = "remove all"; the UI understands this.
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
