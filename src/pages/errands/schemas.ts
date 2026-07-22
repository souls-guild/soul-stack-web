// Zod schemas for the Errand form (ADR-033).
//
// The `module` field is a discriminator: for known core modules pick a typed
// form, otherwise fall back to a JSON textarea (with client-side JSON.parse validation).
// Submit payload — `ErrandRunRequest` from openapi (see ../../api/keeper.ts).

import { z } from 'zod';
import i18n from '../../i18n';

const t = i18n.t.bind(i18n);

// SID = FQDN. Minimal format validation — non-empty, no spaces; full
// FQDN validation happens server-side.
const sidSchema = z
  .string()
  .min(1, t('runhistory:zodSidRequired'))
  .max(253, t('runhistory:zodSidTooLong'))
  .regex(/^[a-zA-Z0-9._-]+$/, t('runhistory:zodSidChars'));

const timeoutSchema = z
  .number({ invalid_type_error: t('runhistory:zodNumberError') })
  .int(t('runhistory:zodIntError'))
  .positive(t('runhistory:zodPositive'))
  .max(3600, t('runhistory:zodMaxTimeout'));

// `env: map<string,string>` — turn into an array of {key,value} pairs for the dynamic
// form; collapse back into a Record on submit.
const envPairSchema = z.object({
  key: z.string().min(1, t('runhistory:zodKeyRequired')),
  value: z.string(),
});

// core.cmd.shell — command line in /bin/sh -c.
// Field names (cmd/cwd) are the ones actually sent to the API; UI labels can be
// human-readable ("Command" / "Working dir"), see ErrandNewForm.tsx.
export const shellSchema = z.object({
  module: z.literal('core.cmd.shell'),
  sid: sidSchema,
  cmd: z.string().min(1, t('runhistory:zodCmdRequired')),
  timeout_seconds: timeoutSchema.default(30),
  cwd: z.string().optional(),
  env: z.array(envPairSchema).optional(),
  dry_run: z.boolean().default(false),
});
export type ShellInput = z.infer<typeof shellSchema>;

// core.exec.run — argv form (no shell). API expects `cmd` — path to the binary.
export const execSchema = z.object({
  module: z.literal('core.exec.run'),
  sid: sidSchema,
  cmd: z.string().min(1, t('runhistory:zodArgsBinaryRequired')),
  // args — textarea with line-per-arg; parsed into an array of strings.
  args_raw: z.string().default(''),
  timeout_seconds: timeoutSchema.default(30),
  cwd: z.string().optional(),
  env: z.array(envPairSchema).optional(),
  dry_run: z.boolean().default(false),
});
export type ExecInput = z.infer<typeof execSchema>;

// Fallback for any other modules — JSON textarea with validation.
export const jsonFallbackSchema = z.object({
  module: z.string().min(1, t('runhistory:zodModuleRequired')),
  sid: sidSchema,
  params_json: z
    .string()
    .default('{}')
    .refine(
      (v) => {
        const t = v.trim();
        if (!t) return true;
        try {
          const parsed = JSON.parse(t);
          return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
        } catch {
          return false;
        }
      },
      { message: t('runhistory:zodInvalidJsonObject') },
    ),
  timeout_seconds: timeoutSchema.default(30),
  dry_run: z.boolean().default(false),
});
export type JsonFallbackInput = z.infer<typeof jsonFallbackSchema>;

// Top-level discriminated union. Discriminator — `module`.
export const errandSchema = z.discriminatedUnion('module', [
  shellSchema,
  execSchema,
  // For an arbitrary string we use jsonFallbackSchema — the discriminator
  // here is NOT a literal but a string; for discriminatedUnion to match correctly, the
  // component switches kind manually (see ErrandNewForm.tsx). Here we
  // only keep known literals; the fallback is parsed with a separate schema.
]);
export type KnownErrandInput = z.infer<typeof errandSchema>;

// Modules that have a typed form with separate fields (instead of a JSON fallback).
// This is a UI decision (which forms are implemented), NOT a whitelist policy — the actual whitelist
// is determined by the backend via GET /v1/modules?errand_safe=true.
export type KnownModule = 'core.cmd.shell' | 'core.exec.run';

const TYPED_MODULES: readonly KnownModule[] = ['core.cmd.shell', 'core.exec.run'];

export function isKnownModule(m: string): m is KnownModule {
  return (TYPED_MODULES as readonly string[]).includes(m);
}

// Mapping from the form -> ErrandRunRequest.input (Record<string, unknown>).
// Parameter names are exactly what the core module expects on the Soul side:
// see soul/internal/coremod/cmd/cmd.go and .../exec/exec.go.
export function shellToInput(v: ShellInput): Record<string, unknown> {
  const out: Record<string, unknown> = { cmd: v.cmd };
  if (v.cwd) out.cwd = v.cwd;
  const env = envPairsToRecord(v.env);
  if (env) out.env = env;
  return out;
}

export function execToInput(v: ExecInput): Record<string, unknown> {
  const out: Record<string, unknown> = { cmd: v.cmd };
  const args = v.args_raw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (args.length) out.args = args;
  if (v.cwd) out.cwd = v.cwd;
  const env = envPairsToRecord(v.env);
  if (env) out.env = env;
  return out;
}

export function jsonFallbackToInput(v: JsonFallbackInput): Record<string, unknown> {
  const t = v.params_json.trim();
  if (!t) return {};
  return JSON.parse(t) as Record<string, unknown>;
}

function envPairsToRecord(
  pairs: Array<{ key: string; value: string }> | undefined,
): Record<string, string> | undefined {
  if (!pairs || pairs.length === 0) return undefined;
  const rec: Record<string, string> = {};
  for (const p of pairs) {
    if (p.key) rec[p.key] = p.value;
  }
  return Object.keys(rec).length ? rec : undefined;
}
