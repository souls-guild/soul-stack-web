import type { ModuleInputSource, ModuleParam, ScenarioInputSchema } from '../../api/keeper';

// Mapping of ModuleParam[] (from the module catalog) to flat-map ScenarioInputSchema,
// to reuse ScenarioInputFields + scenarioInputFields.helpers
// (serializeFields / missingRequiredFields / defaultsFromSchema). input-DSL types
// (string/int/bool/list/map and synonyms) are normalized to simple form types.
// ADR-045 S4: enum/pattern/format/source are passed through for the extended UI
// (SID picker, pattern validation, dropdown).

const INT_TYPES = new Set(['int', 'integer', 'int64', 'int32']);
const NUMBER_TYPES = new Set(['number', 'float', 'float64', 'double']);
const BOOL_TYPES = new Set(['bool', 'boolean']);
// list/array -> array; map/object -> object (normalizeType).
// map is additionally kept as an isMap flag for the KEY->VALUE editor.
const ARRAY_TYPES = new Set(['list', 'array']);
const MAP_TYPES = new Set(['map']);
const OBJECT_TYPES = new Set(['object']);

function normalizeType(raw: string | undefined): string {
  const t = (raw ?? '').toLowerCase();
  if (INT_TYPES.has(t)) return 'integer';
  if (NUMBER_TYPES.has(t)) return 'number';
  if (BOOL_TYPES.has(t)) return 'boolean';
  if (ARRAY_TYPES.has(t)) return 'array';
  if (MAP_TYPES.has(t) || OBJECT_TYPES.has(t)) return 'object';
  return 'string';
}

function isMapRawType(raw: string | undefined): boolean {
  return MAP_TYPES.has((raw ?? '').toLowerCase());
}

export function paramsToInputSchema(params: ModuleParam[] | undefined): ScenarioInputSchema {
  const out: ScenarioInputSchema = {};
  for (const p of params ?? []) {
    out[p.name] = {
      type: normalizeType(p.type),
      required: Boolean(p.required),
      description: p.description,
      // secret flag is passed through for possible masking/hint in the UI.
      secret: Boolean(p.secret),
      // ADR-045: UI extension fields — enum/pattern/format/source/items.
      ...(p.enum != null ? { enum: p.enum } : {}),
      ...(p.pattern != null ? { pattern: p.pattern } : {}),
      ...(p.format != null ? { format: p.format } : {}),
      ...(p.source != null ? { source: p.source } : {}),
      // B3: multiline → textarea; example → placeholder.
      ...(p.multiline != null ? { multiline: p.multiline } : {}),
      ...(p.example != null ? { example: p.example } : {}),
      // B2: isMap preserves the type=map marker (normalized to object) for the KEY->VALUE editor.
      ...(isMapRawType(p.type) ? { isMap: true } : {}),
      // S8b: items describes the element type (list) or value type (map).
      ...(p.items != null ? { items: {
        type: normalizeType(p.items.type),
        format: p.items.format,
        pattern: p.items.pattern,
        source: p.items.source,
        enum: p.items.enum ?? undefined,
        // isMap for nested items (if elements are also a map).
        ...(isMapRawType(p.items.type) ? { isMap: true } : {}),
      } } : {}),
    };
  }
  return out;
}

// Re-export for use in SidPicker without a direct api/keeper import.
export type { ModuleInputSource };

// Whether the module has formalized parameters (plugin modules). An empty array —
// a core module without an input schema (renders cmd fields / dynamic builder).
export function hasParams(params: ModuleParam[] | undefined): boolean {
  return Array.isArray(params) && params.length > 0;
}
