import { z } from 'zod';

// kebab-case по openapi ServiceRegisterRequest.name (pattern '^[a-z][a-z0-9-]*$').
const NAME_RE = /^[a-z][a-z0-9-]*$/;

// git-источник: http(s):// | git:// | ssh (scp-форма user@host:path или ssh://) | file://.
// file:// допускаем намеренно — dev гоняет на file-repos (см. live keeper).
const GIT_RE =
  /^(https?:\/\/|git:\/\/|ssh:\/\/|file:\/\/|[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+:).+/;

// Опц. duration авто-refresh ('5m', '1h30m'). Пусто = без авто-refresh.
const DURATION_RE = /^\d+(ns|us|µs|ms|s|m|h)([0-9]+(ns|us|µs|ms|s|m|h))*$/;

const gitField = z
  .string()
  .trim()
  .min(1, 'Укажите git-источник')
  .refine((v) => GIT_RE.test(v), 'Ожидается git-URL: http(s):// / git:// / ssh / file://');

const refField = z
  .string()
  .trim()
  .min(1, 'Укажите git ref (tag или branch)');

const refreshField = z
  .string()
  .trim()
  .refine((v) => v === '' || DURATION_RE.test(v), 'Duration в формате 5m / 1h / 30s; пусто — без авто-refresh');

export const serviceRegisterSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Укажите имя сервиса')
    .refine((v) => NAME_RE.test(v), 'kebab-case: со строчной буквы, далее [a-z0-9-]'),
  git: gitField,
  ref: refField,
  refresh: refreshField,
});

export type ServiceRegisterFormValues = z.infer<typeof serviceRegisterSchema>;

export const serviceEditSchema = z.object({
  git: gitField,
  ref: refField,
  refresh: refreshField,
});

export type ServiceEditFormValues = z.infer<typeof serviceEditSchema>;
