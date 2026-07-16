// Helpers for the state_schema tab: extracting a flat field list from the MVP
// JSON Schema subset + classifying endpoint degraded-errors. Extracted from SchemaTab.tsx
// (react-refresh: only components in a component file), reused by
// SchemaTab (incarnation) and ServiceSchemaTab (service).

import { ApiError } from '../../api/client';

// MVP subset of JSON Schema: a flat list of top-level fields (name + type +
// required). Nested object/array are shown by type as-is; a deep
// recursive render is not done.
export interface SchemaField {
  name: string;
  type: string;
  required: boolean;
}

export function extractFields(schema: Record<string, unknown> | undefined): SchemaField[] | null {
  if (!schema || typeof schema !== 'object') return null;
  const props = (schema as Record<string, unknown>).properties;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return null;
  const requiredRaw = (schema as Record<string, unknown>).required;
  const required = new Set(
    Array.isArray(requiredRaw) ? requiredRaw.filter((r): r is string => typeof r === 'string') : [],
  );
  const out: SchemaField[] = [];
  for (const [name, def] of Object.entries(props as Record<string, unknown>)) {
    let type = '—';
    if (def && typeof def === 'object' && !Array.isArray(def)) {
      const t = (def as Record<string, unknown>).type;
      if (typeof t === 'string') type = t;
      else if (Array.isArray(t)) type = t.map(String).join(' | ');
    }
    out.push({ name, type, required: required.has(name) });
  }
  return out;
}

// 404 (endpoint/service missing), 501 (not implemented), 502 (loader failed to fetch repo) -
// degrade to a placeholder. Other errors are shown as errorBox.
export function isSchemaDegraded(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 501 || err.status === 502);
}
