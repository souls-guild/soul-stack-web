import { z } from 'zod';

export const PRESETS = ['1d', '7d', '30d', '90d'] as const;

// The keeper `duration` convention a personal token's ttl is sent in: whole
// minutes, hours or days. Anything else is NaN here and refused by the form.
export function durationSeconds(v: string): number {
  const m = /^(\d+)(m|h|d)$/.exec(v.trim());
  if (!m) return Number.NaN;
  const n = Number(m[1]);
  return m[2] === 'd' ? n * 86400 : m[2] === 'h' ? n * 3600 : n * 60;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

// Messages are i18n keys, translated where they are shown (the souls/schemas.ts convention).
export const issueJwtSchema = z
  .object({
    label: z
      .string()
      // Characters as the server counts them (runes), not UTF-16 code units.
      .refine((v) => [...v].length <= 200, 'profile:labelTooLong')
      .refine((v) => !CONTROL.test(v), 'profile:labelControl'),
    preset: z.enum([...PRESETS, 'custom']),
    custom: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.preset !== 'custom') return;
    const s = durationSeconds(v.custom);
    if (!Number.isFinite(s) || s < 60) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['custom'], message: 'profile:ttlFormat' });
    }
  });

export type IssueJwtInput = z.infer<typeof issueJwtSchema>;
