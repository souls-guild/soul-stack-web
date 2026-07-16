// Helpers for DynamicInputBuilder: row types, reversible conversion to JSON and back.
//
// Externally the component communicates via `Record<string, unknown>`. Internally we
// hold an array of FieldRow with a local rowId — stable for the React key (needed
// so editing one row doesn't yank input focus off a neighboring row when
// key === field.key and the user is right in the middle of editing key).

import i18n from '../../i18n';

// Pure functions (outside the React tree) use the global i18n instance.
const t = i18n.t.bind(i18n);

export type FieldType = 'string' | 'number' | 'integer' | 'boolean' | 'json';

export interface FieldRow {
  id: string;
  key: string;
  type: FieldType;
  // value is stored as the "UI source":
  //   string  → string
  //   number  → string (so '12.' and '-' stay editable)
  //   integer → string
  //   boolean → boolean
  //   json    → string (validated at serialization time)
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

// Converts Record<string, unknown> → FieldRow[]. Used on initialization
// and when returning from raw-JSON mode. Type is determined by typeof value;
// object/array → 'json' with a serialized value.
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
  // object / array / null → JSON mode.
  return { id: nextRowId(), key, type: 'json', raw: JSON.stringify(value, null, 2) };
}

export interface FieldsValidation {
  // By row index: reason for invalidity or null.
  rowErrors: Array<string | null>;
  // The combined object, if all rows are valid and keys are unique.
  result: Record<string, unknown> | null;
  duplicateKeys: string[];
}

// Serializes rows into a JSON object while collecting errors. If there is
// even one error — `result === null`, otherwise — the full Record.
//
// Empty rows (key === '') are skipped (this is a "draft" the operator
// hasn't named yet); they are not validated and don't end up in the result.
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

// When switching type, we try to preserve the value's meaning.
export function changeRowType(row: FieldRow, next: FieldType): FieldRow {
  if (row.type === next) return row;
  // From bool → string('true'|'false') or number(1|0).
  if (row.type === 'boolean') {
    const b = Boolean(row.raw);
    if (next === 'string') return { ...row, type: next, raw: b ? 'true' : 'false' };
    if (next === 'integer' || next === 'number') return { ...row, type: next, raw: b ? '1' : '0' };
    if (next === 'json') return { ...row, type: next, raw: b ? 'true' : 'false' };
  }
  // To bool: 'true'/'1' → true.
  if (next === 'boolean') {
    const s = typeof row.raw === 'string' ? row.raw.trim().toLowerCase() : '';
    return { ...row, type: next, raw: s === 'true' || s === '1' };
  }
  // string ↔ number/integer/json — carried over as a string.
  const raw = typeof row.raw === 'string' ? row.raw : String(row.raw);
  return { ...row, type: next, raw };
}

// Serialization for raw-JSON mode (if result === null, we still return
// whatever there is, but including invalid rows as plain strings).
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
