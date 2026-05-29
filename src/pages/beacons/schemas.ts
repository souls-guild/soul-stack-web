// Zod-схемы для форм Vigil/Decree (ADR-030).
//
// Vigil — Soul-side проверка beacons; форма параметров (params) зависит от check
// (адрес core-beacon). Делаем discriminated union по check, fallback — JSON-textarea.
// Submit-payload — `VigilCreateRequest` из openapi (см. ../../api/keeper.ts).

import { z } from 'zod';

// Сообщения валидации хранятся как i18n-ключи (ns beacons); компонент рендерит
// их через t(fieldError.message). См. правило i18n в CLAUDE.md.

// kebab-case 1..63 — симметрично openapi pattern.
const nameSchema = z
  .string()
  .min(1, 'beacons:errNameRequired')
  .max(63, 'beacons:errNameMax')
  .regex(/^[a-z0-9-]{1,63}$/, 'beacons:errNameKebab');

// duration-конвенция Go: 30s / 1m / 1h. Минимально-валидируем — суффикс h/m/s/ms.
const durationSchema = z
  .string()
  .min(1, 'beacons:errDurationRequired')
  .regex(/^\d+(ms|s|m|h)$/, 'beacons:errDurationFormat');

// SID — XOR с coven (проверяем в форме, не в схеме).
const sidSchema = z
  .string()
  .max(253, 'beacons:errSidMax')
  .regex(/^[a-zA-Z0-9._-]+$/, 'beacons:errSidChars')
  .optional()
  .or(z.literal(''));

const covenItemSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'beacons:errCovenKebab');

// --- Vigil: формы per check ---

// core.beacon.file_changed — наблюдение за файлом/директорией.
export const fileChangedSchema = z.object({
  check: z.literal('core.beacon.file_changed'),
  path: z.string().min(1, 'beacons:errPathRequired'),
  recursive: z.boolean().default(false),
  throttle: z.string().optional().or(z.literal('')),
});
export type FileChangedInput = z.infer<typeof fileChangedSchema>;

// core.beacon.service_down — heartbeat init-системы.
export const serviceDownSchema = z.object({
  check: z.literal('core.beacon.service_down'),
  service: z.string().min(1, 'beacons:errServiceRequired'),
});
export type ServiceDownInput = z.infer<typeof serviceDownSchema>;

// core.beacon.port_closed — TCP-probe.
export const portClosedSchema = z.object({
  check: z.literal('core.beacon.port_closed'),
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(1).max(65535),
});
export type PortClosedInput = z.infer<typeof portClosedSchema>;

// core.beacon.process_absent — отсутствует процесс по имени.
export const processAbsentSchema = z.object({
  check: z.literal('core.beacon.process_absent'),
  process: z.string().min(1, 'beacons:errProcessRequired'),
});
export type ProcessAbsentInput = z.infer<typeof processAbsentSchema>;

// core.beacon.http_unhealthy — HTTP-probe.
export const httpUnhealthySchema = z.object({
  check: z.literal('core.beacon.http_unhealthy'),
  url: z.string().url('beacons:errUrl'),
  expected_code: z.number().int().min(100).max(599).default(200),
  timeout: durationSchema.optional().or(z.literal('')),
});
export type HttpUnhealthyInput = z.infer<typeof httpUnhealthySchema>;

// Discriminated union известных check-ов. Fallback — JSON-textarea (см. ниже).
export const beaconConfigSchema = z.discriminatedUnion('check', [
  fileChangedSchema,
  serviceDownSchema,
  portClosedSchema,
  processAbsentSchema,
  httpUnhealthySchema,
]);
export type BeaconConfigInput = z.infer<typeof beaconConfigSchema>;

// Каталог известных beacons (для select-а).
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

// Top-level Vigil-схема: общие поля + params (либо discriminated, либо raw JSON).
export const vigilFormSchema = z
  .object({
    name: nameSchema,
    interval: durationSchema,
    check: z.string().min(1, 'beacons:errCheckRequired'),
    sid: sidSchema,
    coven: z.array(covenItemSchema).default([]),
    enabled: z.boolean().default(true),
    // params — динамика per check; валидируется отдельно поверх kind-схемы.
    params_json: z.string().default('{}'),
  })
  .superRefine((v, ctx) => {
    // XOR coven/sid.
    const hasSid = !!(v.sid && v.sid.length > 0);
    const hasCoven = v.coven.length > 0;
    if (hasSid && hasCoven) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sid'],
        message: 'beacons:errSidCovenXor',
      });
    }
    // params_json должен быть JSON-object.
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

// Маппинги: typed-форма → params Record.
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

// --- Decree-форма ---

export const decreeFormSchema = z
  .object({
    name: nameSchema,
    on_beacon: nameSchema, // имя Vigil-а — тот же kebab-case pattern.
    where: z.string().optional().or(z.literal('')),
    sid: sidSchema,
    coven: z.array(covenItemSchema).default([]),
    incarnation_name: z
      .string()
      .min(1, 'beacons:errIncarnationRequired')
      .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'beacons:errIncarnationKebab'),
    action_scenario: z
      .string()
      .min(1, 'beacons:errActionScenarioRequired')
      .regex(/^[a-z][a-z0-9_]*$/, 'beacons:errActionScenarioSnake'),
    action_input_json: z.string().default('{}'),
    cooldown: durationSchema.optional().or(z.literal('')),
    enabled: z.boolean().default(false), // default-deny: opt-in для safety.
  })
  .superRefine((v, ctx) => {
    const hasSid = !!(v.sid && v.sid.length > 0);
    const hasCoven = v.coven.length > 0;
    if (hasSid && hasCoven) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sid'],
        message: 'beacons:errSidCovenXor',
      });
    }
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
