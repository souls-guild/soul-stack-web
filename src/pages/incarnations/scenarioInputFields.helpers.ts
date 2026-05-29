import type { ScenarioInputSchema, ScenarioInputSchemaProperty } from '../../api/keeper';

// Per-field контракт. Простые типы (string/integer/number/boolean) рендерятся
// типизированным полем; составные (array/object/oneOf/…) — per-field JSON-textarea
// (значение хранится как raw-JSON-строка). Раньше один составной тип ронял ВСЮ
// форму в raw-JSON-fallback (all-or-nothing) — это прятало простые поля схемы.
//
// Backend-shape input_schema — flat-map `{ field: { type, description?, required? } }`,
// НЕ JSON-Schema-обёртка `{ type: 'object', properties: {...} }`.

export type ScenarioFieldValue = string | number | boolean | undefined;
export type ScenarioFieldsState = Record<string, ScenarioFieldValue>;

// Схема пригодна для per-field рендера, если это непустой объект полей. Любой
// набор типов (включая составные) рисуется per-field; единственный fallback на
// общий DynamicInputBuilder — отсутствие/пустота схемы (свободный input).
export function isSupportedInputSchema(
  schema: ScenarioInputSchema | undefined | null,
): boolean {
  if (!schema || typeof schema !== 'object') return false;
  const entries = Object.entries(schema);
  if (entries.length === 0) return false;
  for (const [, prop] of entries) {
    if (!prop || typeof prop !== 'object') return false;
  }
  return true;
}

// Составной тип (array/object) — рендерится per-field JSON-textarea.
export function isCompositeType(prop: ScenarioInputSchemaProperty): boolean {
  return prop.type === 'array' || prop.type === 'object';
}

export function defaultsFromSchema(schema: ScenarioInputSchema): ScenarioFieldsState {
  const out: ScenarioFieldsState = {};
  for (const [key, prop] of Object.entries(schema)) {
    if (prop.default !== undefined) {
      // Составной default ([] / {}) сериализуем в raw-JSON-строку (state хранит
      // составные значения строкой, как и редактируется per-field textarea).
      out[key] = isCompositeType(prop)
        ? JSON.stringify(prop.default)
        : (prop.default as ScenarioFieldValue);
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
// required игнорируется — false валиден. Для составных полей пустота — пустая
// raw-строка (textarea не заполнена).
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
    if (v === undefined || (typeof v === 'string' && v.trim() === '')) out.push(key);
  }
  return out;
}

// Сериализация в payload: '' пропускается, числа конвертируются, составные поля
// парсятся из raw-JSON (невалидный JSON → строка пропускается, blocked submit
// ловит это раньше). Возвращает {ok:false, invalid:[...]} если составное поле
// содержит непарсимый JSON — caller блокирует submit и подсвечивает поле.
export function serializeFields(
  schema: ScenarioInputSchema,
  state: ScenarioFieldsState,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema)) {
    const raw = state[key];
    if (raw === undefined || raw === '') continue;
    if (isCompositeType(prop)) {
      const parsed = tryParseJson(String(raw));
      if (parsed.ok) out[key] = parsed.value;
      continue;
    }
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

// Имена составных полей, чьё непустое raw-значение не парсится в JSON. Caller
// блокирует submit/«Далее», пока есть невалидные (как required-валидация).
export function invalidCompositeFields(
  schema: ScenarioInputSchema | undefined | null,
  state: ScenarioFieldsState,
): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const out: string[] = [];
  for (const [key, prop] of Object.entries(schema)) {
    if (!isCompositeType(prop)) continue;
    const raw = state[key];
    if (raw === undefined || (typeof raw === 'string' && raw.trim() === '')) continue;
    if (!tryParseJson(String(raw)).ok) out.push(key);
  }
  return out;
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}
