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
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ожидается JSON-объект {...}' });
        return z.NEVER;
      }
      return parsed as Record<string, unknown>;
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: e instanceof Error ? `Не парсится как JSON: ${e.message}` : 'Не парсится как JSON',
      });
      return z.NEVER;
    }
  });

export const incarnationCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'обязательное поле')
    .regex(KEBAB, 'kebab-case: ^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  service: z.string().trim().min(1, 'выберите сервис'),
  covens: z
    .array(z.string().regex(KEBAB, 'каждый тег — kebab-case'))
    .default([]),
  inputJson: jsonObjectFromString,
});

export type IncarnationCreateFormInput = z.input<typeof incarnationCreateSchema>;
export type IncarnationCreateFormOutput = z.output<typeof incarnationCreateSchema>;

export const runScenarioSchema = z.object({
  scenario: z
    .string()
    .trim()
    .min(1, 'имя сценария обязательно')
    .regex(/^[a-z][a-z0-9_-]*$/, 'lowercase, цифры, _ и -'),
  inputJson: jsonObjectFromString,
});

export type RunScenarioFormInput = z.input<typeof runScenarioSchema>;
export type RunScenarioFormOutput = z.output<typeof runScenarioSchema>;

export const unlockSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, 'минимум 5 символов')
    .max(500, 'максимум 500 символов'),
});

export type UnlockFormValues = z.infer<typeof unlockSchema>;

export const upgradeSchema = z.object({
  to_version: z
    .string()
    .trim()
    .min(1, 'укажите git-ref целевой версии'),
});

export type UpgradeFormValues = z.infer<typeof upgradeSchema>;

export function makeDestroySchema(expectedName: string) {
  return z.object({
    confirmName: z
      .string()
      .trim()
      .refine((v) => v === expectedName, { message: `имя должно совпадать с "${expectedName}"` }),
    allowDestroy: z.boolean().default(false),
  });
}

export type DestroyFormValues = {
  confirmName: string;
  allowDestroy: boolean;
};
