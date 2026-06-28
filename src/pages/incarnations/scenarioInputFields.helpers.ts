import type { ScenarioInputSchema, ScenarioInputSchemaProperty } from '../../api/keeper';

// Per-field контракт. Простые типы (string/integer/number/boolean) рендерятся
// типизированным полем; составные (array/object/oneOf/…) — per-field JSON-textarea
// (значение хранится как raw-JSON-строка). Раньше один составной тип ронял ВСЮ
// форму в raw-JSON-fallback (all-or-nothing) — это прятало простые поля схемы.
//
// Backend-shape input_schema — flat-map `{ field: { type, description?, required? } }`,
// НЕ JSON-Schema-обёртка `{ type: 'object', properties: {...} }`.

// ---------------------------------------------------------------------------
// Мини-CEL-эвалуатор для show_when-предикатов.
//
// Поддерживаемый синтаксис (достаточно для show_when):
//   - Операторы: ==, !=, &&, ||, in
//   - Литералы: строки в кавычках, числа, true/false
//   - Доступ к полям ввода: input.<field>
//   - Скобки для группировки
//
// Намеренно не реализует: арифметику, функции, has(), list-литералы,
// тернарный оператор — эти конструкции не нужны для show_when.
//
// При синтаксической ошибке или неизвестной конструкции → true (показывать
// поле, а не прятать без причины — graceful fallback).
// ---------------------------------------------------------------------------

type CelValue = string | number | boolean | null;

export function evalShowWhen(expr: string | undefined, inputState: Record<string, unknown>): boolean {
  if (!expr || expr.trim() === '') return true;
  try {
    return Boolean(parseCelExpr(expr.trim(), inputState));
  } catch {
    // Неизвестная конструкция → показываем (безопасный дефолт)
    return true;
  }
}

// ---- Рекурсивный нисходящий парсер ----

interface TokenStream {
  tokens: string[];
  pos: number;
}

function tokenize(expr: string): string[] {
  // Простой токенизатор: разбивает на: строки, числа, идентификаторы/ключевые слова,
  // операторы (&&, ||, ==, !=, in, скобки, точки, запятые).
  const re = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[0-9]+(?:\.[0-9]+)?|[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*|&&|\|\||==|!=|[()[\],]/g;
  return expr.match(re) ?? [];
}

function peek(ts: TokenStream): string | undefined {
  return ts.tokens[ts.pos];
}
function consume(ts: TokenStream): string {
  return ts.tokens[ts.pos++];
}

function parseCelExpr(expr: string, inputState: Record<string, unknown>): CelValue {
  const ts: TokenStream = { tokens: tokenize(expr), pos: 0 };
  const result = parseOr(ts, inputState);
  return result;
}

function parseOr(ts: TokenStream, inputState: Record<string, unknown>): CelValue {
  let left = parseAnd(ts, inputState);
  while (peek(ts) === '||') {
    consume(ts);
    const right = parseAnd(ts, inputState);
    left = Boolean(left) || Boolean(right);
  }
  return left;
}

function parseAnd(ts: TokenStream, inputState: Record<string, unknown>): CelValue {
  let left = parseComparison(ts, inputState);
  while (peek(ts) === '&&') {
    consume(ts);
    const right = parseComparison(ts, inputState);
    left = Boolean(left) && Boolean(right);
  }
  return left;
}

function parseComparison(ts: TokenStream, inputState: Record<string, unknown>): CelValue {
  const left = parsePrimary(ts, inputState);
  const op = peek(ts);
  if (op === '==' || op === '!=' || op === 'in') {
    consume(ts);
    const right = parsePrimary(ts, inputState);
    if (op === '==') return celEq(left, right);
    if (op === '!=') return !celEq(left, right);
    if (op === 'in') {
      // CEL: `value in list` — right может быть строкой из input,
      // которая может представлять список enum-значений (или просто сравнение).
      // Для show_when типичная форма: `input.mode in ["a","b"]` — но т.к. list-
      // литералы [.] не входят в токенизатор, поддерживаем упрощённую форму:
      // left == right — семантика "left содержится в right".
      // Пример: `input.type in "sentinel,cluster"` → false-позиция не нужна,
      // поэтому трактуем как строковое `includes`.
      if (typeof right === 'string') {
        return right.split(',').map((s) => s.trim()).includes(String(left));
      }
      return celEq(left, right);
    }
  }
  return left;
}

function parsePrimary(ts: TokenStream, inputState: Record<string, unknown>): CelValue {
  const tok = peek(ts);
  if (tok === undefined) return null;

  // Скобки
  if (tok === '(') {
    consume(ts);
    const val = parseOr(ts, inputState);
    if (peek(ts) === ')') consume(ts);
    return val;
  }

  // Строковые литералы
  if ((tok.startsWith('"') && tok.endsWith('"')) || (tok.startsWith("'") && tok.endsWith("'"))) {
    consume(ts);
    return tok.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }

  // Числовые литералы
  if (/^[0-9]/.test(tok)) {
    consume(ts);
    return tok.includes('.') ? parseFloat(tok) : parseInt(tok, 10);
  }

  // Булевые литералы
  if (tok === 'true') { consume(ts); return true; }
  if (tok === 'false') { consume(ts); return false; }
  if (tok === 'null') { consume(ts); return null; }

  // Доступ к полю: input.<name> или input.<name>.<subname>
  if (tok.startsWith('input.')) {
    consume(ts);
    const path = tok.slice('input.'.length); // может быть составным
    return resolveInputPath(path, inputState);
  }

  // Голый идентификатор (вдруг встретится) — пропускаем
  consume(ts);
  return null;
}

function resolveInputPath(path: string, inputState: Record<string, unknown>): CelValue {
  const parts = path.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = inputState;
  for (const p of parts) {
    if (cur === null || cur === undefined) return null;
    if (typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  if (cur === undefined) return null;
  if (typeof cur === 'string' || typeof cur === 'number' || typeof cur === 'boolean' || cur === null) {
    return cur;
  }
  return String(cur);
}

function celEq(a: CelValue, b: CelValue): boolean {
  // Нестрогое сравнение: число и строка числа считаются равными.
  if (a === b) return true;
  if (a === null || b === null) return false;
  // Числовое сравнение через строку (input.[field] хранится как string)
  const sa = String(a);
  const sb = String(b);
  return sa === sb;
}

export type ScenarioFieldValue = string | number | boolean | undefined;
export type ScenarioFieldsState = Record<string, ScenarioFieldValue>;

// Вычисляет обязательность поля по текущему input-state.
// required:true → всегда обязательно.
// required_when → обязательно, когда CEL-предикат истинен (тот же evalShowWhen-контекст).
// Для boolean-полей обязательность игнорируется (false — допустимое значение).
export function isFieldRequired(
  prop: ScenarioInputSchemaProperty,
  inputState: Record<string, unknown>,
): boolean {
  if (prop.type === 'boolean') return false;
  if (prop.required === true) return true;
  if (prop.required_when) return evalShowWhen(prop.required_when, inputState);
  return false;
}

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

// Array-of-object: type=array + items.type=object + items.properties.
// Рендерится карточками с под-полями, не JSON-textarea (не TypedListField).
export function isArrayOfObjectField(prop: ScenarioInputSchemaProperty): boolean {
  return (
    prop.type === 'array' &&
    prop.items?.type === 'object' &&
    typeof prop.items?.['properties'] === 'object' &&
    prop.items?.['properties'] !== null
  );
}

// Typed list (ADR-045 S8b): type=array + scalar/sid items → рендерится числовым/строковым
// списком с +/- кнопками, НЕ JSON-textarea. Значение в state — JSON-строка массива.
// Исключение: items.type=object+properties → ArrayOfObjectField (не TypedListField).
export function isTypedListField(prop: ScenarioInputSchemaProperty): boolean {
  if (prop.type !== 'array' || prop.items == null) return false;
  if (isArrayOfObjectField(prop)) return false;
  return true;
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
// Исключения: type=array+items → TypedListField; type=object+isMap+scalarItems → MapEditor;
// type=array+items.type=object+items.properties → ArrayOfObjectField.
export function isCompositeType(prop: ScenarioInputSchemaProperty): boolean {
  if (isTypedListField(prop)) return false;
  if (isMapWithScalarItems(prop)) return false;
  if (isArrayOfObjectField(prop)) return false;
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

// Вычисляет набор видимых имён полей по form + текущему state.
// Поле видимо, если: show_when его секции истинно/отсутствует И show_when самого поля истинно/отсутствует.
// Если form не задан — возвращает undefined (все поля видимы — нет фильтрации).
import type { ScenarioForm } from '../../api/keeper';
export function computeVisibleFields(
  form: ScenarioForm | undefined,
  state: ScenarioFieldsState,
): Set<string> | undefined {
  if (!form?.sections || form.sections.length === 0) return undefined;
  const visible = new Set<string>();
  for (const section of form.sections) {
    const sectionVisible = evalShowWhen(section.show_when, state as Record<string, unknown>);
    if (!sectionVisible) continue;
    for (const field of section.fields ?? []) {
      const fieldVisible = evalShowWhen(field.show_when, state as Record<string, unknown>);
      if (fieldVisible) visible.add(field.name);
    }
  }
  return visible;
}

// Имена required-полей схемы, которые в текущем state пусты (зеркалит backend
// required-валидацию: '' / undefined считаются незаполненными). Для boolean
// required игнорируется — false валиден. Для составных полей пустота — пустая
// raw-строка (textarea не заполнена).
// visibleFields: если передано — проверяем только видимые поля (show_when).
// Скрытые поля пропускаются — UI не шлёт их в payload.
// Учитывает required_when: поле обязательно когда CEL-предикат истинен (isFieldRequired).
export function missingRequiredFields(
  schema: ScenarioInputSchema | undefined | null,
  state: ScenarioFieldsState,
  visibleFields?: Set<string>,
): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const out: string[] = [];
  const inputState = state as Record<string, unknown>;
  for (const [key, prop] of Object.entries(schema)) {
    if (!isFieldRequired(prop, inputState)) continue;
    // Скрытое поле (show_when=false) — не требуется.
    if (visibleFields !== undefined && !visibleFields.has(key)) continue;
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
    // Array-of-object: хранится как JSON-строка массива объектов.
    // Отдаём в payload как распарсенный массив (объекты с нативными строками).
    if (isArrayOfObjectField(prop)) {
      const parsed = tryParseJson(String(raw));
      if (parsed.ok && Array.isArray(parsed.value)) {
        out[key] = parsed.value;
      }
      continue;
    }
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
