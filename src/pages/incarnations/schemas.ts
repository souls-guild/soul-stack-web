// Zod schemas for Incarnation forms. Regexes synced with openapi.yaml
// (IncarnationCreateRequest / coven pattern).

import { z } from 'zod';
import { WEEKDAYS, browserTimeZone, isValidTimeZone, nextDay, wallToIso } from './maintenance';

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

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
  // declaring `id_template` composes the id server-side and REJECTS a request that
  // carries one, so a hard `min(1)` in the schema made those services impossible to create
  // from the console at all (NIM-340).
  //
  // The rule is a property of the CHOSEN SCENARIO, not of the field, and this schema is a
  // module-level constant with no way to see the selection — so `IncarnationNewForm` gates
  // the empty id against `composes_id` before submitting. Read that check together with
  // this relaxation: on its own the line below looks like the id is simply optional, and it
  // is not.
  //
  // The format check does stay here, and applies to whatever value IS present.
  id: z
    .string()
    .trim()
    .refine((v) => v === '' || KEBAB.test(v), 'incarnations:kebabPattern'),
  // The caption is free text and always optional — a composing scenario composes the
  // id, never the caption, so this field is offered in both branches of the form.
  label: z.string().trim(),
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

// Maintenance window form (NIM-1076). The wire carries a duration; the form asks for
// an end time, because "02:00–05:00" is how an operator says a slot.
export const maintenanceWindowSchema = z
  .object({
    days: z.array(z.enum(WEEKDAYS)).min(1, 'incarnations:mwDaysRequired'),
    start: z.string().regex(HHMM, 'incarnations:mwTimeFormat'),
    end: z.string().regex(HHMM, 'incarnations:mwTimeFormat'),
    timezone: z
      .string()
      .trim()
      .min(1, 'incarnations:mwTimezoneRequired')
      .max(64, 'incarnations:mwTimezoneInvalid')
      .refine(isValidTimeZone, { message: 'incarnations:mwTimezoneInvalid' }),
    comment: z.string().trim().max(500, 'incarnations:mwCommentMax'),
  });

export type MaintenanceWindowFormValues = z.infer<typeof maintenanceWindowSchema>;

// Freeze form: whole days (date inputs, last day inclusive) or exact moments
// (date + time). Both are wall clock in the browser's zone.
export const freezeSchema = z
  .object({
    wholeDays: z.boolean(),
    startDate: z.string().regex(YMD, 'incarnations:freezeDateRequired'),
    startTime: z.string(),
    endDate: z.string().regex(YMD, 'incarnations:freezeDateRequired'),
    endTime: z.string(),
    comment: z.string().trim().max(500, 'incarnations:mwCommentMax'),
  })
  .superRefine((v, ctx) => {
    if (!v.wholeDays) {
      if (!HHMM.test(v.startTime)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startTime'], message: 'incarnations:mwTimeFormat' });
      }
      if (!HHMM.test(v.endTime)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endTime'], message: 'incarnations:mwTimeFormat' });
      }
    }
    const range = freezeRangeFromForm(v, browserTimeZone());
    if (range && new Date(range.ends_at) <= new Date(range.starts_at)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'incarnations:freezeEndBeforeStart' });
    }
  });

export type FreezeFormValues = z.infer<typeof freezeSchema>;

/** The wire interval of a freeze form in `tz`; whole days end at midnight after the last day. */
export function freezeRangeFromForm(
  v: {
    wholeDays: boolean;
    startDate: string;
    startTime: string;
    endDate: string;
    endTime: string;
  },
  tz: string,
): { starts_at: string; ends_at: string } | null {
  const starts = wallToIso(v.startDate, v.wholeDays ? '00:00' : v.startTime, tz);
  const ends = v.wholeDays ? wallToIso(nextDay(v.endDate), '00:00', tz) : wallToIso(v.endDate, v.endTime, tz);
  return starts && ends ? { starts_at: starts, ends_at: ends } : null;
}
