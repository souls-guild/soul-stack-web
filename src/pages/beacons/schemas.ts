// Zod schemas for Vigil/Decree forms (ADR-030).
//
// Vigil — Soul-side beacon check; params form depends on check
// (core-beacon address). Discriminated union by check, fallback — JSON textarea.
// Submit payload — `VigilCreateRequest` from openapi (see ../../api/keeper.ts).

import { z } from 'zod';

// Validation messages are stored as i18n keys (ns beacons); the component renders
// them via t(fieldError.message). See the i18n rule in CLAUDE.md.

// kebab-case 1..63 — mirrors the openapi pattern.
const nameSchema = z
  .string()
  .min(1, 'beacons:errNameRequired')
  .max(63, 'beacons:errNameMax')
  .regex(/^[a-z0-9-]{1,63}$/, 'beacons:errNameKebab');

// Go duration convention: 30s / 1m / 1h. Minimal validation — suffix h/m/s/ms.
const durationSchema = z
  .string()
  .min(1, 'beacons:errDurationRequired')
  .regex(/^\d+(ms|s|m|h)$/, 'beacons:errDurationFormat');

// The subject is NOT part of these schemas. It is one of four alternative
// shapes, two of them pairs, and it is validated by validateSubjectDraft in
// ./subject.ts — the same function both forms call, so there is one answer to
// "is this subject legal" rather than one per form.

// --- Vigil: per-check forms ---

// core.beacon.file_changed — watches a file/directory.
export const fileChangedSchema = z.object({
  check: z.literal('core.beacon.file_changed'),
  path: z.string().min(1, 'beacons:errPathRequired'),
  recursive: z.boolean().default(false),
  throttle: z.string().optional().or(z.literal('')),
});
export type FileChangedInput = z.infer<typeof fileChangedSchema>;

// core.beacon.service_down — init-system heartbeat.
export const serviceDownSchema = z.object({
  check: z.literal('core.beacon.service_down'),
  service: z.string().min(1, 'beacons:errServiceRequired'),
});
export type ServiceDownInput = z.infer<typeof serviceDownSchema>;

// core.beacon.port_closed — TCP probe.
export const portClosedSchema = z.object({
  check: z.literal('core.beacon.port_closed'),
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(1).max(65535),
});
export type PortClosedInput = z.infer<typeof portClosedSchema>;

// core.beacon.process_absent — process missing by name.
export const processAbsentSchema = z.object({
  check: z.literal('core.beacon.process_absent'),
  process: z.string().min(1, 'beacons:errProcessRequired'),
});
export type ProcessAbsentInput = z.infer<typeof processAbsentSchema>;

// core.beacon.http_unhealthy — HTTP probe.
export const httpUnhealthySchema = z.object({
  check: z.literal('core.beacon.http_unhealthy'),
  url: z.string().url('beacons:errUrl'),
  expected_code: z.number().int().min(100).max(599).default(200),
  timeout: durationSchema.optional().or(z.literal('')),
});
export type HttpUnhealthyInput = z.infer<typeof httpUnhealthySchema>;

// Discriminated union of known checks. Fallback — JSON textarea (see below).
export const beaconConfigSchema = z.discriminatedUnion('check', [
  fileChangedSchema,
  serviceDownSchema,
  portClosedSchema,
  processAbsentSchema,
  httpUnhealthySchema,
]);
export type BeaconConfigInput = z.infer<typeof beaconConfigSchema>;

// Catalog of known beacons (for the select).
export const KNOWN_BEACONS = [
  'core.beacon.file_changed',
  'core.beacon.service_down',
  'core.beacon.port_closed',
  'core.beacon.process_absent',
  'core.beacon.http_unhealthy',
] as const;
export type KnownBeacon = (typeof KNOWN_BEACONS)[number];

export function isKnownBeacon(c: string): c is KnownBeacon {
  return (KNOWN_BEACONS as readonly string[]).includes(c);
}

// Top-level Vigil schema: common fields + params (either discriminated or raw JSON).
export const vigilFormSchema = z
  .object({
    name: nameSchema,
    interval: durationSchema,
    check: z.string().min(1, 'beacons:errCheckRequired'),
    enabled: z.boolean(),
    // params — per-check dynamics; validated separately on top of the kind schema.
    params_json: z.string(),
  })
  .superRefine((v, ctx) => {
    // params_json must be a JSON object.
    try {
      const parsed = JSON.parse(v.params_json || '{}');
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['params_json'],
          message: 'beacons:errParamsJsonObject',
        });
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['params_json'],
        message: 'beacons:errInvalidJson',
      });
    }
  });

export type VigilFormInput = z.infer<typeof vigilFormSchema>;

// Mappings: typed form -> params Record.
export function fileChangedToParams(v: FileChangedInput): Record<string, unknown> {
  const out: Record<string, unknown> = { path: v.path, recursive: v.recursive };
  if (v.throttle) out.throttle = v.throttle;
  return out;
}
export function serviceDownToParams(v: ServiceDownInput): Record<string, unknown> {
  return { service: v.service };
}
export function portClosedToParams(v: PortClosedInput): Record<string, unknown> {
  return { host: v.host, port: v.port };
}
export function processAbsentToParams(v: ProcessAbsentInput): Record<string, unknown> {
  return { process: v.process };
}
export function httpUnhealthyToParams(v: HttpUnhealthyInput): Record<string, unknown> {
  const out: Record<string, unknown> = { url: v.url, expected_code: v.expected_code };
  if (v.timeout) out.timeout = v.timeout;
  return out;
}

// --- Decree form ---

export const decreeFormSchema = z
  .object({
    name: nameSchema,
    on_beacon: nameSchema, // Vigil name — same kebab-case pattern.
    where: z.string().optional().or(z.literal('')),
    incarnation_name: z
      .string()
      .min(1, 'beacons:errIncarnationRequired')
      .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'beacons:errIncarnationKebab'),
    action_scenario: z
      .string()
      .min(1, 'beacons:errActionScenarioRequired')
      .regex(/^[a-z][a-z0-9_]*$/, 'beacons:errActionScenarioSnake'),
    action_input_json: z.string(),
    cooldown: durationSchema.optional().or(z.literal('')),
    enabled: z.boolean(), // default-deny: opt-in for safety; default set in defaultValues.
  })
  .superRefine((v, ctx) => {
    try {
      const parsed = JSON.parse(v.action_input_json || '{}');
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['action_input_json'],
          message: 'beacons:errActionInputJsonObject',
        });
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['action_input_json'],
        message: 'beacons:errInvalidJson',
      });
    }
  });

export type DecreeFormInput = z.infer<typeof decreeFormSchema>;
