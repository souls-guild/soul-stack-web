import type { ScenarioInputSchema, ScenarioInputSchemaProperty } from '../../api/keeper';

// Минимальный per-field контракт: string/integer/number/boolean.
// Любой непростой тип (array/object/oneOf/…) → caller рисует JSON-textarea fallback.
// Это сознательно ограниченный form-builder, не perfect.
//
// Backend-shape input_schema — flat-map `{ field: { type, description?, required? } }`,
// НЕ JSON-Schema-обёртка `{ type: 'object', properties: {...} }`.

export type ScenarioFieldValue = string | number | boolean | undefined;
export type ScenarioFieldsState = Record<string, ScenarioFieldValue>;

export function isSupportedInputSchema(
  schema: ScenarioInputSchema | undefined | null,
): boolean {
  if (!schema || typeof schema !== 'object') return false;
  const entries = Object.entries(schema);
  if (entries.length === 0) return false;
  for (const [, prop] of entries) {
    if (!prop || typeof prop !== 'object') return false;
    if (!isSimpleType(prop)) return false;
  }
  return true;
}

function isSimpleType(prop: ScenarioInputSchemaProperty): boolean {
  return (
    prop.type === 'string' ||
    prop.type === 'integer' ||
    prop.type === 'number' ||
    prop.type === 'boolean'
  );
}

export function defaultsFromSchema(schema: ScenarioInputSchema): ScenarioFieldsState {
  const out: ScenarioFieldsState = {};
  for (const [key, prop] of Object.entries(schema)) {
    if (prop.default !== undefined) {
      out[key] = prop.default as ScenarioFieldValue;
    } else if (prop.type === 'boolean') {
      out[key] = false;
    } else {
      out[key] = '';
    }
  }
  return out;
}

// Имена required-полей схемы, которые в текущем state пусты (зеркалит backend
// required-валидацию: '' / undefined считаются незаполненными). Для boolean
// required игнорируется — false валиден.
export function missingRequiredFields(
  schema: ScenarioInputSchema | undefined | null,
  state: ScenarioFieldsState,
): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const out: string[] = [];
  for (const [key, prop] of Object.entries(schema)) {
    if (!prop?.required) continue;
    if (prop.type === 'boolean') continue;
    const v = state[key];
    if (v === undefined || v === '') out.push(key);
  }
  return out;
}

// Сериализация в payload: '' пропускается, числа конвертируются.
export function serializeFields(
  schema: ScenarioInputSchema,
  state: ScenarioFieldsState,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema)) {
    const raw = state[key];
    if (raw === undefined || raw === '') continue;
    if (prop.type === 'integer') {
      const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
      if (!Number.isNaN(n)) out[key] = n;
    } else if (prop.type === 'number') {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      if (!Number.isNaN(n)) out[key] = n;
    } else if (prop.type === 'boolean') {
      out[key] = Boolean(raw);
    } else {
      out[key] = String(raw);
    }
  }
  return out;
}
