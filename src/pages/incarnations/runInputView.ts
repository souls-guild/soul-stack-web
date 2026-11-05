import type { ScenarioInputSchemaProperty, ServiceScenarioInfo } from '../../api/keeper';
import { evalShowWhen } from './scenarioInputFields.helpers';

// The run's input laid out the way the operator filled it in: by the sections and
// labels of the scenario's form (NIM-1175). Pure, so the grouping rules are tested
// without a page around them.

// The write-path masker's placeholder (audit.MaskSecrets).
export const MASKED = '***MASKED***';

export interface InputRow {
  key: string;
  label: string;
  description?: string;
  prop?: ScenarioInputSchemaProperty;
  // present — the key is in the run's input; an absent field is shown as not set.
  present: boolean;
  value: unknown;
  // isDefault — present and equal to the schema's default.
  isDefault: boolean;
}

// section — a form section, or the one untitled group of a form-less schema / of
// an input read without a schema. other — schema fields the form leaves out.
// unknown — keys the input carries and the schema does not declare.
export type InputGroupKind = 'section' | 'other' | 'unknown';

export interface InputGroup {
  key: string;
  kind: InputGroupKind;
  title?: string;
  rows: InputRow[];
  // wide — holds a list of objects, which reads as a table and needs the width.
  wide: boolean;
}

type Scenario = Pick<ServiceScenarioInfo, 'input_schema' | 'form'>;

export function buildInputGroups(input: Record<string, unknown>, scenario?: Scenario): InputGroup[] {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key);
  const schema = scenario?.input_schema ?? {};

  const row = (key: string, label?: string): InputRow => {
    const prop = schema[key];
    const present = has(key);
    const value = input[key];
    return {
      key,
      label: label || key,
      description: prop?.description,
      prop,
      present,
      value,
      isDefault: present && prop?.default !== undefined && sameValue(value, prop.default),
    };
  };
  const group = (key: string, kind: InputGroupKind, rows: InputRow[], title?: string): InputGroup => ({
    key,
    kind,
    title,
    rows,
    wide: rows.some((r) => isListOfObjects(r.value)),
  });

  if (!scenario) {
    const rows = Object.keys(input).map((k) => row(k));
    return rows.length > 0 ? [group('input', 'section', rows)] : [];
  }

  const groups: InputGroup[] = [];
  const shown = new Set<string>();
  const sections = scenario.form?.sections ?? [];

  if (sections.length > 0) {
    for (const section of sections) {
      const rows: InputRow[] = [];
      for (const f of section.fields ?? []) {
        if (shown.has(f.name) || (!schema[f.name] && !has(f.name))) continue;
        // A field the form hid was not filled in; one that is in the input anyway
        // is shown regardless, so nothing the run carried disappears.
        const visible = evalShowWhen(section.show_when, input) && evalShowWhen(f.show_when, input);
        if (!has(f.name) && !visible) continue;
        shown.add(f.name);
        rows.push(row(f.name, f.label));
      }
      if (rows.length > 0) groups.push(group(section.key, 'section', rows, section.title));
    }
    const rest = Object.keys(schema).filter((k) => !shown.has(k) && has(k));
    rest.forEach((k) => shown.add(k));
    if (rest.length > 0) groups.push(group('__other', 'other', rest.map((k) => row(k))));
  } else {
    const keys = Object.keys(schema);
    keys.forEach((k) => shown.add(k));
    if (keys.length > 0) groups.push(group('input', 'section', keys.map((k) => row(k))));
  }

  const unknown = Object.keys(input).filter((k) => !shown.has(k) && !schema[k]);
  if (unknown.length > 0) groups.push(group('__unknown', 'unknown', unknown.map((k) => row(k))));
  return groups;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isListOfObjects(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.length > 0 && v.every(isPlainObject);
}

// Columns of a list of objects: the item schema's own order first, then any other
// key in the order the items carry it.
export function objectListColumns(items: Record<string, unknown>[], itemProp?: ScenarioInputSchemaProperty): string[] {
  const cols = Object.keys(itemProp?.properties ?? {}).filter((k) => items.some((it) => k in it));
  for (const it of items) {
    for (const k of Object.keys(it)) if (!cols.includes(k)) cols.push(k);
  }
  return cols;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && sameValue(a[k], b[k]));
  }
  return false;
}
