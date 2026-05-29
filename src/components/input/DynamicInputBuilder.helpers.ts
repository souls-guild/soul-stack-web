// Helpers DynamicInputBuilder: row-types, обратимая конвертация в JSON и обратно.
//
// Снаружи компонент общается через `Record<string, unknown>`. Внутри держим
// массив FieldRow с локальным rowId — стабильным для React-key (это нужно,
// чтобы редактирование одного row не дёргало input-focus у соседнего, когда
// key === field.key и пользователь как раз правит key).

import i18n from '../../i18n';

// Pure-функции (вне React-дерева) используют глобальный i18n-инстанс.
const t = i18n.t.bind(i18n);

export type FieldType = 'string' | 'number' | 'integer' | 'boolean' | 'json';

export interface FieldRow {
  id: string;
  key: string;
  type: FieldType;
  // value хранится как «исходник для UI»:
  //   string  → string
  //   number  → string (чтобы '12.' и '-' оставались редактируемыми)
  //   integer → string
  //   boolean → boolean
  //   json    → string (валидируется в момент сериализации)
  raw: string | boolean;
}

let rowCounter = 0;
export function nextRowId(): string {
  rowCounter += 1;
  return `r${rowCounter}`;
}

export function newEmptyRow(): FieldRow {
  return { id: nextRowId(), key: '', type: 'string', raw: '' };
}

// Конвертация Record<string, unknown> → FieldRow[]. Используется при инициализации
// и при возврате из raw-JSON-режима. Тип определяется по typeof value;
// object/array → 'json' с сериализованным значением.
export function parseRawJsonToFields(obj: Record<string, unknown>): FieldRow[] {
  const out: FieldRow[] = [];
  for (const [key, value] of Object.entries(obj)) {
    out.push(valueToRow(key, value));
  }
  return out;
}

function valueToRow(key: string, value: unknown): FieldRow {
  if (typeof value === 'boolean') {
    return { id: nextRowId(), key, type: 'boolean', raw: value };
  }
  if (typeof value === 'number') {
    const isInt = Number.isInteger(value);
    return { id: nextRowId(), key, type: isInt ? 'integer' : 'number', raw: String(value) };
  }
  if (typeof value === 'string') {
    return { id: nextRowId(), key, type: 'string', raw: value };
  }
  // object / array / null → JSON-режим.
  return { id: nextRowId(), key, type: 'json', raw: JSON.stringify(value, null, 2) };
}

export interface FieldsValidation {
  // По индексам rows: причина невалидности или null.
  rowErrors: Array<string | null>;
  // Общий объект, если все строки валидны и ключи уникальны.
  result: Record<string, unknown> | null;
  duplicateKeys: string[];
}

// Сериализует строки в JSON-объект и параллельно собирает ошибки. Если есть
// хоть одна ошибка — `result === null`, иначе — полный Record.
//
// Пустые строки (key === '') пропускаются (это «черновик», в который оператор
// ещё не вписал имя), не валидируются и не попадают в результат.
export function fieldsToObject(rows: FieldRow[]): FieldsValidation {
  const rowErrors: Array<string | null> = rows.map(() => null);
  const seenKeys = new Map<string, number>(); // key → first row index
  const duplicates = new Set<string>();
  const accum: Record<string, unknown> = {};
  let anyError = false;

  rows.forEach((row, idx) => {
    if (row.key === '') {
      return;
    }
    if (seenKeys.has(row.key)) {
      rowErrors[idx] = t('run:builderDuplicateKey');
      duplicates.add(row.key);
      const prev = seenKeys.get(row.key)!;
      if (rowErrors[prev] === null) rowErrors[prev] = t('run:builderDuplicateKey');
      anyError = true;
      return;
    }
    seenKeys.set(row.key, idx);

    const coerced = coerceRowValue(row);
    if (coerced.error) {
      rowErrors[idx] = coerced.error;
      anyError = true;
      return;
    }
    accum[row.key] = coerced.value;
  });

  return {
    rowErrors,
    result: anyError ? null : accum,
    duplicateKeys: Array.from(duplicates),
  };
}

interface CoerceResult {
  value?: unknown;
  error: string | null;
}

function coerceRowValue(row: FieldRow): CoerceResult {
  switch (row.type) {
    case 'boolean':
      return { value: Boolean(row.raw), error: null };
    case 'string':
      return { value: typeof row.raw === 'string' ? row.raw : String(row.raw), error: null };
    case 'integer': {
      const raw = typeof row.raw === 'string' ? row.raw.trim() : String(row.raw);
      if (raw === '') return { value: 0, error: null };
      if (!/^-?\d+$/.test(raw)) return { error: t('run:builderNotInteger') };
      const n = Number(raw);
      if (!Number.isFinite(n)) return { error: t('run:builderNotInteger') };
      return { value: n, error: null };
    }
    case 'number': {
      const raw = typeof row.raw === 'string' ? row.raw.trim() : String(row.raw);
      if (raw === '') return { value: 0, error: null };
      const n = Number(raw);
      if (!Number.isFinite(n)) return { error: t('run:builderNotNumber') };
      return { value: n, error: null };
    }
    case 'json': {
      const raw = typeof row.raw === 'string' ? row.raw.trim() : '';
      if (raw === '') return { value: null, error: null };
      try {
        const parsed = JSON.parse(raw);
        return { value: parsed, error: null };
      } catch (e) {
        return { error: e instanceof Error ? `JSON: ${e.message}` : t('run:builderInvalidJson') };
      }
    }
  }
}

// При переключении типа стараемся сохранить значение по смыслу.
export function changeRowType(row: FieldRow, next: FieldType): FieldRow {
  if (row.type === next) return row;
  // Из bool → string('true'|'false') или number(1|0).
  if (row.type === 'boolean') {
    const b = Boolean(row.raw);
    if (next === 'string') return { ...row, type: next, raw: b ? 'true' : 'false' };
    if (next === 'integer' || next === 'number') return { ...row, type: next, raw: b ? '1' : '0' };
    if (next === 'json') return { ...row, type: next, raw: b ? 'true' : 'false' };
  }
  // В bool: 'true'/'1' → true.
  if (next === 'boolean') {
    const s = typeof row.raw === 'string' ? row.raw.trim().toLowerCase() : '';
    return { ...row, type: next, raw: s === 'true' || s === '1' };
  }
  // string ↔ number/integer/json — переносим как строку.
  const raw = typeof row.raw === 'string' ? row.raw : String(row.raw);
  return { ...row, type: next, raw };
}

// Сериализация для raw-JSON-режима (если result === null, всё равно отдаём
// то, что есть, но включая невалидные строки как plain string).
export function fieldsToObjectLossy(rows: FieldRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    if (row.key === '') continue;
    if (row.key in out) continue;
    const coerced = coerceRowValue(row);
    if (coerced.error) {
      out[row.key] = typeof row.raw === 'string' ? row.raw : String(row.raw);
    } else {
      out[row.key] = coerced.value;
    }
  }
  return out;
}
