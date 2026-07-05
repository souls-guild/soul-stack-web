// Zod-схема Provider create-формы. Регэкспы синхронизированы с openapi.yaml
// (ProviderCreateRequest.name/type kebab-case); серверная валидация — источник
// правды (422 показываем как server-error). Сообщения — i18n-ключи namespace
// `providers`; рендер через t(fieldError.message).

import { z } from 'zod';

const KEBAB = /^[a-z0-9-]{1,63}$/;

/** Парсит "key: value" построчно в объект credentials. Строки без ':' игнорируются. */
export function parseCredentialsKV(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

// credentials — dual-mode (ADR-064): значение (KV) XOR credentials_ref. XOR
// структурно гарантирован переключателем; refine требует непустой активный режим
// (клиентская проверка «заполни ровно одно»).
export const providerCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'providers:errNameRequired').regex(KEBAB, 'providers:errNamePattern'),
    type: z.string().trim().min(1, 'providers:errTypeRequired').regex(KEBAB, 'providers:errTypePattern'),
    region: z.string().trim().min(1, 'providers:errRegionRequired'),
    fqdnSuffix: z.string().trim(),
    credMode: z.enum(['value', 'ref']),
    credValue: z.string(),
    credRef: z.string(),
  })
  .superRefine((v, ctx) => {
    const provided =
      v.credMode === 'value'
        ? Object.keys(parseCredentialsKV(v.credValue)).length > 0
        : v.credRef.trim() !== '';
    if (!provided) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'providers:errCredentialsRequired',
        path: [v.credMode === 'value' ? 'credValue' : 'credRef'],
      });
    }
  });

export type ProviderCreateFormValues = z.infer<typeof providerCreateSchema>;
