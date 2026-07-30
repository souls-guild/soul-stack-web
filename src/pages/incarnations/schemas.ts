// Zod schemas for Incarnation forms. Regexes synced with openapi.yaml
// (IncarnationCreateRequest / coven pattern).

import { z } from 'zod';

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// JSON input as a string -> parsed via .transform; empty string = `{}`.
// On invalid JSON, mark the field as invalid with a clear message.
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
  // Empty is allowed HERE, and required is enforced in the form instead. A create scenario
  // declaring `name_template` composes the name server-side and REJECTS a request that
  // carries one, so a hard `min(1)` in the schema made those services impossible to create
  // from the console at all (NIM-340).
  //
  // The rule is a property of the CHOSEN SCENARIO, not of the field, and this schema is a
  // module-level constant with no way to see the selection — so `IncarnationNewForm` gates
  // the empty name against `composes_name` before submitting. Read that check together with
  // this relaxation: on its own the line below looks like the name is simply optional, and it
  // is not.
  //
  // The format check does stay here, and applies to whatever value IS present.
  name: z
    .string()
    .trim()
    .refine((v) => v === '' || KEBAB.test(v), 'incarnations:kebabPattern'),
  service: z.string().trim().min(1, 'incarnations:noService'),
  covens: z
    .array(z.string().regex(KEBAB, 'incarnations:kebabEach'))
    .default([]),
  inputJson: jsonObjectFromString,
  // traits: key -> scalar|list (ADR-060); stored outside as TraitsMap, in the schema as passthrough.
  traits: z.record(z.union([z.string(), z.array(z.string())])).default({}),
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
    allowDestroy: z.boolean(),
  });
}

export type DestroyFormValues = {
  confirmName: string;
  allowDestroy: boolean;
};
