import { z } from 'zod';

// kebab-case per openapi ServiceRegisterRequest.id (pattern '^[a-z][a-z0-9-]*$').
const ID_RE = /^[a-z][a-z0-9-]*$/;

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
  id: z
    .string()
    .trim()
    .min(1, 'admin:svcErrIdRequired')
    .refine((v) => ID_RE.test(v), 'admin:svcErrIdPattern'),
  // Free text and optional: an omitted caption means consumers show the id.
  // Deliberately unconstrained — it derives no path, so nothing can break on it.
  label: z.string().trim(),
  git: gitField,
  ref: refField,
  refresh: refreshField,
});

export type ServiceRegisterFormValues = z.infer<typeof serviceRegisterSchema>;

// No `id`: it is immutable, so the edit form shows it read-only and never
// submits it. `label` is here because it is the only half of the identity that
// an edit may touch.
export const serviceEditSchema = z.object({
  label: z.string().trim(),
  git: gitField,
  ref: refField,
  refresh: refreshField,
});

export type ServiceEditFormValues = z.infer<typeof serviceEditSchema>;
