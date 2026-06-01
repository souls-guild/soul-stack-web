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

// Typed list (ADR-045 S8b): type=array + items → рендерится числовым/строковым
// списком с +/- кнопками, НЕ JSON-textarea. Значение в state — JSON-строка массива.
export function isTypedListField(prop: ScenarioInputSchemaProperty): boolean {
  return prop.type === 'array' && prop.items != null;
}

const SCALAR_TYPES = new Set(['string', 'integer', 'number', 'boolean']);

// B2: type=object + isMap=true + items.type скалярный → KEY→VALUE-редактор.
// cloud.profile (map без items / items.type=map|object) → JSON-textarea.
export function isMapWithScalarItems(prop: ScenarioInputSchemaProperty): boolean {
  return (
    prop.type === 'object' &&
    Boolean(prop.isMap) &&
    prop.items != null &&
    SCALAR_TYPES.has(prop.items.type ?? '')
  );
}

// Составной тип (array/object) — рендерится per-field JSON-textarea.
// Исключения: type=array+items → TypedListField; type=object+isMap+scalarItems → MapEditor.
export function isCompositeType(prop: ScenarioInputSchemaProperty): boolean {
  if (isTypedListField(prop)) return false;
  if (isMapWithScalarItems(prop)) return false;
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
    if (v === undefined || (typeof v === 'string' && v.trim() === '')) { out.push(key); continue; }
    // Typed list: пустой массив [] считается незаполненным для required-поля.
    if (isTypedListField(prop) && typeof v === 'string') {
      const parsed = tryParseJson(v);
      if (parsed.ok && Array.isArray(parsed.value) && parsed.value.length === 0) out.push(key);
    }
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
    // Typed list (ADR-045 S8b): хранится как JSON-строка сырых строк ["", "123"].
    // Конвертируем элементы: int → parseInt (NaN фильтруется), иначе → строка.
    if (isTypedListField(prop)) {
      const parsed = tryParseJson(String(raw));
      if (parsed.ok && Array.isArray(parsed.value)) {
        const itemsType = prop.items?.type ?? 'string';
        if (itemsType === 'integer') {
          const nums = (parsed.value as unknown[])
            .map((s) => parseInt(String(s), 10))
            .filter((n) => !Number.isNaN(n));
          out[key] = nums;
        } else if (itemsType === 'number') {
          const nums = (parsed.value as unknown[])
            .map((s) => parseFloat(String(s)))
            .filter((n) => !Number.isNaN(n));
          out[key] = nums;
        } else {
          out[key] = (parsed.value as unknown[]).map((s) => String(s)).filter((s) => s !== '');
        }
      }
      continue;
    }
    // B2: map+scalar items — хранится как JSON-строка объекта {"key":"val",...}.
    // Конвертируем значения по items.type (int → parseInt).
    if (isMapWithScalarItems(prop)) {
      const parsed = tryParseJson(String(raw));
      if (parsed.ok && typeof parsed.value === 'object' && parsed.value !== null && !Array.isArray(parsed.value)) {
        const itemsType = prop.items?.type ?? 'string';
        const obj = parsed.value as Record<string, unknown>;
        if (itemsType === 'integer') {
          const converted: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(obj)) {
            const n = parseInt(String(v), 10);
            if (!Number.isNaN(n)) converted[k] = n;
          }
          out[key] = converted;
        } else if (itemsType === 'number') {
          const converted: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(obj)) {
            const n = parseFloat(String(v));
            if (!Number.isNaN(n)) converted[k] = n;
          }
          out[key] = converted;
        } else {
          out[key] = obj;
        }
      }
      continue;
    }
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
// Включает JSON-textarea (isCompositeType) и MapEditor (isMapWithScalarItems).
export function invalidCompositeFields(
  schema: ScenarioInputSchema | undefined | null,
  state: ScenarioFieldsState,
): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const out: string[] = [];
  for (const [key, prop] of Object.entries(schema)) {
    if (!isCompositeType(prop) && !isMapWithScalarItems(prop)) continue;
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
