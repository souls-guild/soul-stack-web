import type { ScenarioInputSchema, ScenarioInputSchemaProperty } from '../../api/keeper';

// Per-field contract. Simple types (string/integer/number/boolean) render as a
// typed field; composite types (array/object/oneOf/...) - per-field JSON textarea
// (value stored as a raw JSON string). Previously one composite type would drop
// the ENTIRE form into raw-JSON-fallback (all-or-nothing) - this hid simple schema fields.
//
// Backend-shape input_schema is a flat-map `{ field: { type, description?, required? } }`,
// NOT a JSON-Schema wrapper `{ type: 'object', properties: {...} }`.

// ---------------------------------------------------------------------------
// Mini CEL evaluator for show_when predicates.
//
// Supported syntax (enough for show_when):
//   - Operators: ==, !=, &&, ||, in
//   - Literals: quoted strings, numbers, true/false
//   - Access to input fields: input.<field>
//   - Parentheses for grouping
//
// Intentionally not implemented: arithmetic, functions, has(), list literals,
// ternary operator - these constructs aren't needed for show_when.
//
// On a syntax error or unknown construct -> true (show the field
// rather than hide it without reason - graceful fallback).
// ---------------------------------------------------------------------------

type CelValue = string | number | boolean | null;

export function evalShowWhen(expr: string | undefined, inputState: Record<string, unknown>): boolean {
  if (!expr || expr.trim() === '') return true;
  try {
    return Boolean(parseCelExpr(expr.trim(), inputState));
  } catch {
    // Unknown construct -> show it (safe default)
    return true;
  }
}

// ---- Recursive descent parser ----

interface TokenStream {
  tokens: string[];
  pos: number;
}

function tokenize(expr: string): string[] {
  // Simple tokenizer: splits into: strings, numbers, identifiers/keywords,
  // operators (&&, ||, ==, !=, in, parentheses, dots, commas).
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
      // CEL: `value in list` - right can be a string from input,
      // which may represent a list of enum values (or just a comparison).
      // For show_when the typical form is: `input.mode in ["a","b"]` - but since
      // list literals [.] aren't part of the tokenizer, we support a simplified form:
      // left == right - semantics "left is contained in right".
      // Example: `input.type in "sentinel,cluster"` -> a false-branch isn't needed,
      // so we treat it as a string `includes`.
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

  // Parentheses
  if (tok === '(') {
    consume(ts);
    const val = parseOr(ts, inputState);
    if (peek(ts) === ')') consume(ts);
    return val;
  }

  // String literals
  if ((tok.startsWith('"') && tok.endsWith('"')) || (tok.startsWith("'") && tok.endsWith("'"))) {
    consume(ts);
    return tok.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }

  // Numeric literals
  if (/^[0-9]/.test(tok)) {
    consume(ts);
    return tok.includes('.') ? parseFloat(tok) : parseInt(tok, 10);
  }

  // Boolean literals
  if (tok === 'true') { consume(ts); return true; }
  if (tok === 'false') { consume(ts); return false; }
  if (tok === 'null') { consume(ts); return null; }

  // Field access: input.<name> or input.<name>.<subname>
  if (tok.startsWith('input.')) {
    consume(ts);
    const path = tok.slice('input.'.length); // may be a compound path
    return resolveInputPath(path, inputState);
  }

  // Bare identifier (in case one shows up) - skip it
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
  // Loose comparison: a number and its string form are considered equal.
  if (a === b) return true;
  if (a === null || b === null) return false;
  // Numeric comparison via string (input.[field] is stored as a string)
  const sa = String(a);
  const sb = String(b);
  return sa === sb;
}

export type ScenarioFieldValue = string | number | boolean | undefined;
export type ScenarioFieldsState = Record<string, ScenarioFieldValue>;

// ---------------------------------------------------------------------------
// Redis directives (NIM-76): inline validation + typeahead of map-field keys.
//
// The catalog (series->names) is threaded through to MapEditor; ONLY fields with
// a truthy `x-directives` are validated. Version is reactive (create - operator's
// choice; runtime - state.redis_version). Catalog unavailable -> graceful-degrade (don't block).
// ---------------------------------------------------------------------------

// UI context for the directive catalog. `loaded` - catalog is actually available (otherwise don't validate).
export interface DirectiveCatalogContext {
  directives: Record<string, string[]>;
  loaded: boolean;
}

// Tag of a directive-dictionary field (truthy `x-directives`, e.g. "redis"). Field name is not hardcoded.
export function directiveFieldTag(prop: ScenarioInputSchemaProperty): string | undefined {
  const tag = prop['x-directives'];
  return typeof tag === 'string' && tag !== '' ? tag : undefined;
}

// Redis series from a full version: the first two components ("8.2.2" -> "8.2").
// Mirrors the backend regex `^([0-9]+:)?<series>[.]`: strips whitespace, a leading "v"
// ("v8.2.2"), and a Debian epoch ("5:7.4.1-1~deb12u7" -> "7.4") - otherwise an epoch-pinned
// version would silently disable validation, and the backend would reject the directive at render time.
export function versionToSeries(version: string | undefined): string | undefined {
  if (!version) return undefined;
  const cleaned = version
    .trim()
    .replace(/^v/i, '')
    .replace(/^\d+:/, '');
  const parts = cleaned.split('.');
  if (parts.length < 2 || parts[0] === '' || parts[1] === '') return undefined;
  return `${parts[0]}.${parts[1]}`;
}

// Directive names for the version from the catalog, or undefined - validation not applicable
// (catalog not loaded / series unknown / series not in catalog). undefined -> graceful.
export function directiveNamesForVersion(
  catalog: DirectiveCatalogContext | undefined,
  version: string | undefined,
): string[] | undefined {
  if (!catalog?.loaded) return undefined;
  const series = versionToSeries(version);
  if (!series) return undefined;
  const names = catalog.directives[series];
  return Array.isArray(names) ? names : undefined;
}

// Whether the schema has at least one directive-dictionary field (gate for fetching the catalog/version).
export function schemaHasDirectiveField(schema: ScenarioInputSchema | undefined | null): boolean {
  if (!schema || typeof schema !== 'object') return false;
  return Object.values(schema).some((prop) => Boolean(prop) && directiveFieldTag(prop) !== undefined);
}

// Computes whether a field is required from the current input state.
// required:true -> always required.
// required_when -> required when the CEL predicate is true (same evalShowWhen context).
// For boolean fields, requiredness is ignored (false is a valid value).
export function isFieldRequired(
  prop: ScenarioInputSchemaProperty,
  inputState: Record<string, unknown>,
): boolean {
  if (prop.type === 'boolean') return false;
  if (prop.required === true) return true;
  // NIM-72: object-$type carries field-level requiredness in x-required (the key
  // `required` is taken by the array of required children). We set `*` on the field from it.
  if (prop['x-required'] === true) return true;
  if (prop.required_when) return evalShowWhen(prop.required_when, inputState);
  return false;
}

// A schema is suitable for per-field render if it's a non-empty field object. Any
// set of types (including composite) is rendered per-field; the only fallback to
// the generic DynamicInputBuilder is an absent/empty schema (free-form input).
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
// Rendered as cards with sub-fields, not a JSON textarea (not TypedListField).
export function isArrayOfObjectField(prop: ScenarioInputSchemaProperty): boolean {
  return (
    prop.type === 'array' &&
    prop.items?.type === 'object' &&
    typeof prop.items?.['properties'] === 'object' &&
    prop.items?.['properties'] !== null
  );
}

// Typed list (ADR-045 S8b): type=array + scalar/sid items -> rendered as a numeric/string
// list with +/- buttons, NOT a JSON textarea. Value in state is a JSON string of the array.
// Exception: items.type=object+properties -> ArrayOfObjectField (not TypedListField).
export function isTypedListField(prop: ScenarioInputSchemaProperty): boolean {
  if (prop.type !== 'array' || prop.items == null) return false;
  if (isArrayOfObjectField(prop)) return false;
  return true;
}

const SCALAR_TYPES = new Set(['string', 'integer', 'number', 'boolean']);

// B2: type=object + isMap=true + items.type scalar -> KEY->VALUE editor.
// cloud.profile (map without items / items.type=map|object) -> JSON textarea.
export function isMapWithScalarItems(prop: ScenarioInputSchemaProperty): boolean {
  return (
    prop.type === 'object' &&
    Boolean(prop.isMap) &&
    prop.items != null &&
    SCALAR_TYPES.has(prop.items.type ?? '')
  );
}

// Map value type: from items.type (isMap path) OR additional_properties.type
// (backend path without the isMap flag). Default is string.
export function mapValueType(prop: ScenarioInputSchemaProperty): string {
  if (prop.items?.type) return prop.items.type;
  const ap = prop['additional_properties'];
  if (ap && typeof ap === 'object' && !Array.isArray(ap)) {
    const t = (ap as Record<string, unknown>)['type'];
    if (typeof t === 'string') return t;
  }
  return 'string';
}

// Map via additional_properties: type=object + additional_properties - a scalar
// schema (has type). The backend sends redis_settings/update_config as
// {type:object, additional_properties:{type:string}} WITHOUT the isMap flag -> also MapEditor.
export function isMapWithAdditionalProps(prop: ScenarioInputSchemaProperty): boolean {
  if (prop.type !== 'object') return false;
  const ap = prop['additional_properties'];
  if (!ap || typeof ap !== 'object' || Array.isArray(ap)) return false;
  const apType = (ap as Record<string, unknown>)['type'];
  return typeof apType === 'string' && SCALAR_TYPES.has(apType);
}

// Single typed object: type=object + non-empty properties, NOT a map
// (isMap/additional_properties) and NOT provision. Rendered recursively via sub-fields,
// not a JSON textarea. AclUser (add_user.user): {type:object, properties:{name,perms,state}}.
export function isObjectWithProperties(prop: ScenarioInputSchemaProperty): boolean {
  if (prop.type !== 'object') return false;
  if (isProvisionObjectField(prop)) return false;
  if (isMapWithScalarItems(prop)) return false;
  if (isMapWithAdditionalProps(prop)) return false;
  // additional_properties as a schema object (has type) -> it's a map, not a typed object.
  const ap = prop['additional_properties'];
  if (ap && typeof ap === 'object' && !Array.isArray(ap) && typeof (ap as Record<string, unknown>)['type'] === 'string') {
    return false;
  }
  const props = prop['properties'];
  return Boolean(props && typeof props === 'object' && !Array.isArray(props) && Object.keys(props as object).length > 0);
}

// Composite type (array/object) - rendered as a per-field JSON textarea.
// Exceptions: type=array+items -> TypedListField; type=object+map -> MapEditor;
// type=array+items.type=object+items.properties -> ArrayOfObjectField;
// type=object+properties -> ObjectField (recursive).
export function isCompositeType(prop: ScenarioInputSchemaProperty): boolean {
  if (isTypedListField(prop)) return false;
  if (isMapWithScalarItems(prop)) return false;
  if (isMapWithAdditionalProps(prop)) return false;
  if (isArrayOfObjectField(prop)) return false;
  if (isObjectWithProperties(prop)) return false;
  return prop.type === 'array' || prop.type === 'object';
}

// Preset of safe ACL defaults for AclUser objects. A single source for
// ArrayOfObjectField (per-item add) and a single object (defaultsFromSchema).
export const ACL_USER_PRESET: Record<string, string> = {
  perms: 'allchannels allkeys +@all -@admin -@dangerous +info',
  state: 'on',
};

export function defaultsFromSchema(schema: ScenarioInputSchema): ScenarioFieldsState {
  const out: ScenarioFieldsState = {};
  for (const [key, prop] of Object.entries(schema)) {
    if (isObjectWithProperties(prop)) {
      // Recursive sub-field defaults, serialized into a JSON string of the object
      // (an object-with-properties value is stored as a string, same as composite/map).
      const sub = defaultsFromSchema(getObjectProperties(prop));
      // AclUser: preset of safe ACL defaults (parity with ArrayOfObjectField).
      if (prop['x-type'] === 'AclUser') {
        for (const [k, v] of Object.entries(ACL_USER_PRESET)) {
          if (sub[k] === undefined || sub[k] === '') sub[k] = v;
        }
      }
      out[key] = JSON.stringify(sub);
      continue;
    }
    if (prop.default !== undefined) {
      // Composite default ([] / {}) is serialized into a raw JSON string (state stores
      // composite values as a string, same as edited by the per-field textarea).
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

// Computes the set of visible field names from form + the current state.
// A field is visible if: its section's show_when is true/absent AND the field's own show_when is true/absent.
// If form is not set - returns undefined (all fields visible - no filtering).
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

// Names of required schema fields that are empty in the current state (mirrors the backend's
// required validation: '' / undefined are considered unfilled). For boolean fields,
// required is ignored - false is valid. For composite fields, emptiness means an empty
// raw string (textarea not filled).
// visibleFields: if passed - check only visible fields (show_when).
// Hidden fields are skipped - the UI doesn't send them in the payload.
// Accounts for required_when: field is required when the CEL predicate is true (isFieldRequired).
export function missingRequiredFields(
  schema: ScenarioInputSchema | undefined | null,
  state: ScenarioFieldsState,
  visibleFields?: Set<string>,
): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const out: string[] = [];
  const inputState = state as Record<string, unknown>;
  for (const [key, prop] of Object.entries(schema)) {
    // Single typed object: requiredness is set at the object level via
    // required:[children] - we check that required sub-fields are non-empty.
    if (isObjectWithProperties(prop)) {
      if (visibleFields !== undefined && !visibleFields.has(key)) continue;
      const reqRaw: unknown = prop.required;
      const requiredKeys = Array.isArray(reqRaw) ? (reqRaw as string[]) : [];
      if (requiredKeys.length === 0) continue;
      const subState = parseObjectFieldValue(state[key]);
      for (const subKey of requiredKeys) {
        const sv = subState[subKey];
        if (sv === undefined || (typeof sv === 'string' && sv.trim() === '')) out.push(`${key}.${subKey}`);
      }
      continue;
    }
    if (!isFieldRequired(prop, inputState)) continue;
    // Hidden field (show_when=false) - not required.
    if (visibleFields !== undefined && !visibleFields.has(key)) continue;
    const v = state[key];
    if (v === undefined || (typeof v === 'string' && v.trim() === '')) { out.push(key); continue; }
    // Typed list: an empty array [] counts as unfilled for a required field.
    if (isTypedListField(prop) && typeof v === 'string') {
      const parsed = tryParseJson(v);
      if (parsed.ok && Array.isArray(parsed.value) && parsed.value.length === 0) out.push(key);
    }
  }
  return out;
}

// Serialization into payload: '' is skipped, numbers are converted, composite fields
// are parsed from raw JSON (invalid JSON -> the field is skipped, blocked submit
// catches it earlier). Returns {ok:false, invalid:[...]} if a composite field
// contains unparseable JSON - the caller blocks submit and highlights the field.
export function serializeFields(
  schema: ScenarioInputSchema,
  state: ScenarioFieldsState,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema)) {
    const raw = state[key];
    if (raw === undefined || raw === '') continue;
    // Array-of-object: stored as a JSON string of an array of objects.
    // Emitted to the payload as a parsed array (objects with native strings).
    if (isArrayOfObjectField(prop)) {
      const parsed = tryParseJson(String(raw));
      if (parsed.ok && Array.isArray(parsed.value)) {
        out[key] = parsed.value;
      }
      continue;
    }
    // Typed list (ADR-045 S8b): stored as a JSON string of raw strings ["", "123"].
    // Convert elements: int -> parseInt (NaN filtered out), otherwise -> string.
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
    // Map (isMap OR additional_properties) - a JSON string of an object {"key":"val",...}.
    // Convert values by value type (int -> parseInt).
    if (isMapWithScalarItems(prop) || isMapWithAdditionalProps(prop)) {
      const parsed = tryParseJson(String(raw));
      if (parsed.ok && typeof parsed.value === 'object' && parsed.value !== null && !Array.isArray(parsed.value)) {
        const itemsType = mapValueType(prop);
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
    // Single typed object - recursive serialization of sub-fields
    // (subState is stored as ScenarioFieldsState in a JSON string of the object).
    if (isObjectWithProperties(prop)) {
      const subState = parseObjectFieldValue(raw);
      out[key] = serializeFields(getObjectProperties(prop), subState);
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

// Names of composite fields whose non-empty raw value doesn't parse as JSON. The caller
// blocks submit/"Next" while any are invalid (like required validation).
// Includes JSON textarea (isCompositeType) and MapEditor (isMapWithScalarItems).
export function invalidCompositeFields(
  schema: ScenarioInputSchema | undefined | null,
  state: ScenarioFieldsState,
): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const out: string[] = [];
  for (const [key, prop] of Object.entries(schema)) {
    if (!isCompositeType(prop) && !isMapWithScalarItems(prop) && !isMapWithAdditionalProps(prop)) continue;
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

// Parses the serialized value of an object-with-properties field into sub-state
// (Record sub-field->ScenarioFieldValue). Empty/unparseable -> {}.
export function parseObjectFieldValue(raw: ScenarioFieldValue): ScenarioFieldsState {
  if (raw === undefined || raw === '') return {};
  const parsed = tryParseJson(String(raw));
  if (parsed.ok && parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)) {
    return parsed.value as ScenarioFieldsState;
  }
  return {};
}

// ---------------------------------------------------------------------------
// Cloud-provision helpers (UX-clarity, ADR-061)
//
// A provision field - an object with a nested enabled:boolean (enabled=false by
// default). Special render: toggle + sub-fields; hint about existing souls.
// ---------------------------------------------------------------------------

/**
 * Recognizes a provision field: object with properties.enabled.type=boolean.
 * This is the marker of a "cloud-create opt-in" section, which we render specially.
 */
export function isProvisionObjectField(prop: ScenarioInputSchemaProperty): boolean {
  if (prop.type !== 'object') return false;
  const props = prop['properties'] as Record<string, ScenarioInputSchemaProperty> | undefined;
  if (!props || typeof props !== 'object') return false;
  const enabledProp = props['enabled'];
  return Boolean(enabledProp && enabledProp.type === 'boolean');
}

/**
 * Name of the input field a scenario declares as its ROSTER — the souls the
 * incarnation is created on (`source: { roster: true }`, ADR-081). null when the
 * scenario declares none, which is what tells the form there is no roster to collect.
 *
 * Both shapes `source` is allowed on are accepted: on the field itself (single SID) and
 * on `items` (the multi-select array form).
 *
 * This is what replaced guessing from the scenario NAME (`includes('from_souls')`): the
 * schema states it, so a differently-named scenario gets the picker and a scenario that
 * provisions its own hosts does not.
 */
export function rosterFieldName(schema: ScenarioInputSchema | undefined): string | null {
  if (!schema) return null;
  const names = Object.keys(schema)
    .filter((name) => {
      const prop = schema[name];
      if (!prop) return false;
      return Boolean(prop.source?.roster || prop.items?.source?.roster);
    })
    .sort();
  return names.length > 0 ? names[0] : null;
}

/**
 * SIDs currently held by a roster field. The multi picker stores its value as a raw JSON
 * array string and the single one as a plain SID, so both are read here — the form gates
 * submit on the COUNT, and a shape mismatch would silently read as zero selected.
 */
export function rosterSelectedSids(raw: ScenarioFieldValue): string[] {
  if (raw === undefined || raw === '') return [];
  const text = String(raw);
  const parsed = tryParseJson(text);
  if (parsed.ok && Array.isArray(parsed.value)) {
    return parsed.value.filter((v): v is string => typeof v === 'string' && v !== '');
  }
  return [text];
}

/**
 * Computes the expected host count from the current input state.
 * sentinel -> 1 + replicas_per_master
 * cluster  -> shards x (1 + replicas_per_master)
 * Returns null if the needed fields are missing or the values aren't numbers.
 */
export function computeRequiredHostCount(state: ScenarioFieldsState): number | null {
  const replicas = toInt(state['replicas_per_master']);
  const shards = toInt(state['shards']);
  const redisType = state['redis_type'];

  if (redisType === 'cluster') {
    if (shards === null || replicas === null) return null;
    return shards * (1 + replicas);
  }
  // sentinel / any mode with replicas_per_master
  if (replicas !== null) {
    return 1 + replicas;
  }
  return null;
}

function toInt(v: ScenarioFieldValue): number | null {
  if (v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Extracts properties of an object field (provision). If the field is not
 * an object with properties - returns an empty object.
 */
export function getObjectProperties(
  prop: ScenarioInputSchemaProperty,
): Record<string, ScenarioInputSchemaProperty> {
  const props = prop['properties'] as Record<string, ScenarioInputSchemaProperty> | undefined;
  return props && typeof props === 'object' ? props : {};
}

/**
 * Reads the enabled value from a serialized JSON object of a provision field.
 * Returns false if the field is empty / unparseable.
 */
export function readProvisionEnabled(raw: ScenarioFieldValue): boolean {
  if (!raw || raw === '') return false;
  const parsed = tryParseJson(String(raw));
  if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) return false;
  const obj = parsed.value as Record<string, unknown>;
  return Boolean(obj['enabled']);
}

/**
 * Returns a new serialized string of the provision object with updated enabled.
 * If raw is empty - creates the object from scratch.
 */
export function setProvisionEnabled(raw: ScenarioFieldValue, enabled: boolean): string {
  let obj: Record<string, unknown> = {};
  if (raw && raw !== '') {
    const parsed = tryParseJson(String(raw));
    if (parsed.ok && typeof parsed.value === 'object' && parsed.value !== null) {
      obj = { ...(parsed.value as Record<string, unknown>) };
    }
  }
  obj['enabled'] = enabled;
  return JSON.stringify(obj);
}

/**
 * Returns a new serialized string with an updated sub-field.
 */
export function setProvisionSubField(
  raw: ScenarioFieldValue,
  subKey: string,
  subValue: string,
): string {
  let obj: Record<string, unknown> = {};
  if (raw && raw !== '') {
    const parsed = tryParseJson(String(raw));
    if (parsed.ok && typeof parsed.value === 'object' && parsed.value !== null) {
      obj = { ...(parsed.value as Record<string, unknown>) };
    }
  }
  if (subValue === '') {
    delete obj[subKey];
  } else {
    obj[subKey] = subValue;
  }
  return JSON.stringify(obj);
}

/**
 * Reads a string sub-field from serialized provision JSON.
 */
export function readProvisionSubField(raw: ScenarioFieldValue, subKey: string): string {
  if (!raw || raw === '') return '';
  const parsed = tryParseJson(String(raw));
  if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) return '';
  const obj = parsed.value as Record<string, unknown>;
  const v = obj[subKey];
  return v === undefined || v === null ? '' : String(v);
}
