// Zod-схемы для форм Incarnation. Регэкспы синхронизированы с openapi.yaml
// (IncarnationCreateRequest / coven pattern).

import { z } from 'zod';

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// JSON-инпут как строка → парсится через .transform; пустая строка = `{}`.
// При невалидном JSON отдаём поле как невалидное и понятный message.
const jsonObjectFromString = z
  .string()
  .trim()
  .transform((raw, ctx) => {
    if (raw === '') return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'incarnations:jsonNotObject' });
        return z.NEVER;
      }
      return parsed as Record<string, unknown>;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'incarnations:jsonParseFail',
      });
      return z.NEVER;
    }
  });

export const incarnationCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'incarnations:nameRequired')
    .regex(KEBAB, 'incarnations:kebabPattern'),
  service: z.string().trim().min(1, 'incarnations:noService'),
  covens: z
    .array(z.string().regex(KEBAB, 'incarnations:kebabEach'))
    .default([]),
  inputJson: jsonObjectFromString,
});

export type IncarnationCreateFormInput = z.input<typeof incarnationCreateSchema>;
export type IncarnationCreateFormOutput = z.output<typeof incarnationCreateSchema>;

export const runScenarioSchema = z.object({
  scenario: z
    .string()
    .trim()
    .min(1, 'incarnations:scenarioRequired')
    .regex(/^[a-z][a-z0-9_-]*$/, 'incarnations:scenarioNameLower'),
  inputJson: jsonObjectFromString,
});

export type RunScenarioFormInput = z.input<typeof runScenarioSchema>;
export type RunScenarioFormOutput = z.output<typeof runScenarioSchema>;

export const unlockSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, 'incarnations:reasonMin')
    .max(500, 'incarnations:reasonMax'),
});

export type UnlockFormValues = z.infer<typeof unlockSchema>;

export const upgradeSchema = z.object({
  to_version: z
    .string()
    .trim()
    .min(1, 'incarnations:toVersionRequired'),
});

export type UpgradeFormValues = z.infer<typeof upgradeSchema>;

export function makeDestroySchema(expectedName: string) {
  return z.object({
    confirmName: z
      .string()
      .trim()
      .refine((v) => v === expectedName, { message: 'incarnations:confirmNameMismatch' }),
    allowDestroy: z.boolean().default(false),
  });
}

export type DestroyFormValues = {
  confirmName: string;
  allowDestroy: boolean;
};
