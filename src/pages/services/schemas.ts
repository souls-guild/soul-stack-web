import { z } from 'zod';

// kebab-case per openapi ServiceRegisterRequest.name (pattern '^[a-z][a-z0-9-]*$').
const NAME_RE = /^[a-z][a-z0-9-]*$/;

// git source: http(s):// | git:// | ssh (scp form user@host:path or ssh://) | file://.
// file:// is allowed intentionally — dev runs against file-repos (see live keeper).
const GIT_RE =
  /^(https?:\/\/|git:\/\/|ssh:\/\/|file:\/\/|[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+:).+/;

// Optional auto-refresh duration ('5m', '1h30m'). Empty = no auto-refresh.
const DURATION_RE = /^\d+(ns|us|µs|ms|s|m|h)([0-9]+(ns|us|µs|ms|s|m|h))*$/;

// Messages are i18n keys in the `admin` namespace; rendered via t(fieldError.message).
const gitField = z
  .string()
  .trim()
  .min(1, 'admin:svcErrGitRequired')
  .refine((v) => GIT_RE.test(v), 'admin:svcErrGitPattern');

const refField = z
  .string()
  .trim()
  .min(1, 'admin:svcErrRefRequired');

const refreshField = z
  .string()
  .trim()
  .refine((v) => v === '' || DURATION_RE.test(v), 'admin:svcErrRefreshFormat');

export const serviceRegisterSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'admin:svcErrNameRequired')
    .refine((v) => NAME_RE.test(v), 'admin:svcErrNamePattern'),
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
