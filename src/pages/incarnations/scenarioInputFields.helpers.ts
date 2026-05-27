import type { ScenarioInputSchema, ScenarioInputSchemaProperty } from '../../api/keeper';

// Минимальный per-field JSON-Schema контракт: string/integer/number/boolean.
// Любой непростой тип (array/object/oneOf/…) → caller рисует JSON-textarea fallback.
// Это сознательно ограниченный form-builder, не perfect.

export type ScenarioFieldValue = string | number | boolean | undefined;
export type ScenarioFieldsState = Record<string, ScenarioFieldValue>;

export function isSupportedInputSchema(schema: ScenarioInputSchema | undefined): boolean {
  if (!schema) return false;
  if (schema.type !== 'object') return false;
  if (!schema.properties || Object.keys(schema.properties).length === 0) return false;
  for (const prop of Object.values(schema.properties)) {
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
  if (!schema.properties) return out;
  for (const [key, prop] of Object.entries(schema.properties)) {
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

// Сериализация в payload: '' пропускается, числа конвертируются.
export function serializeFields(
  schema: ScenarioInputSchema,
  state: ScenarioFieldsState,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!schema.properties) return out;
  for (const [key, prop] of Object.entries(schema.properties)) {
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
