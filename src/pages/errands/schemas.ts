// Zod-схемы для Errand-формы (ADR-033).
//
// Поле `module` — дискриминатор: для known core-модулей выбираем типизированную
// форму, иначе fall-back на JSON-textarea (с client-side JSON.parse валидацией).
// Submit-payload — `ErrandRunRequest` из openapi (см. ../../api/keeper.ts).

import { z } from 'zod';
import i18n from '../../i18n';

const t = i18n.t.bind(i18n);

// SID = FQDN. Минимально-валидируем формат — не пусто, без пробелов; полноценная
// FQDN-валидация на сервере.
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

// `env: map<string,string>` — превратим в массив пар {key,value} для динамической
// формы; на submit-е свернём в Record.
const envPairSchema = z.object({
  key: z.string().min(1, t('runhistory:zodKeyRequired')),
  value: z.string(),
});

// core.cmd.shell — командная строка в /bin/sh -c.
// Имена полей (cmd/cwd) — те, что реально шлются в API; UI-label-ы могут быть
// человекочитаемыми («Command» / «Working dir»), см. ErrandNewForm.tsx.
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

// core.exec.run — argv-форма (без shell). API ждёт `cmd` — путь к бинарю.
export const execSchema = z.object({
  module: z.literal('core.exec.run'),
  sid: sidSchema,
  cmd: z.string().min(1, t('runhistory:zodArgsBinaryRequired')),
  // args — текстарea с line-per-arg; парсим в массив строк.
  args_raw: z.string().default(''),
  timeout_seconds: timeoutSchema.default(30),
  cwd: z.string().optional(),
  env: z.array(envPairSchema).optional(),
  dry_run: z.boolean().default(false),
});
export type ExecInput = z.infer<typeof execSchema>;

// Fallback для любых других модулей — JSON-textarea с валидацией.
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

// Top-level discriminated union. Дискриминатор — `module`.
export const errandSchema = z.discriminatedUnion('module', [
  shellSchema,
  execSchema,
  // Для произвольной строки используем jsonFallbackSchema — дискриминатор
  // тут НЕ literal, а string; чтобы discriminatedUnion корректно сматчил, в
  // компоненте мы переключаем kind вручную (см. ErrandNewForm.tsx). Здесь
  // оставляем только known-литералы; fallback парсим отдельной схемой.
]);
export type KnownErrandInput = z.infer<typeof errandSchema>;

// Известные core-модули с типизированной формой.
export const KNOWN_MODULES = ['core.cmd.shell', 'core.exec.run'] as const;
export type KnownModule = (typeof KNOWN_MODULES)[number];

export function isKnownModule(m: string): m is KnownModule {
  return (KNOWN_MODULES as readonly string[]).includes(m);
}

// Маппинг формы → ErrandRunRequest.input (Record<string, unknown>).
// Имена параметров строго те, что ждёт core-модуль на стороне Soul:
// см. soul/internal/coremod/cmd/cmd.go и .../exec/exec.go.
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
