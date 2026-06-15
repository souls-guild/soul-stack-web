import type { ModuleInputSource, ModuleParam, ScenarioInputSchema } from '../../api/keeper';

// Маппинг ModuleParam[] (из каталога модулей) на flat-map ScenarioInputSchema,
// чтобы переиспользовать ScenarioInputFields + scenarioInputFields.helpers
// (serializeFields / missingRequiredFields / defaultsFromSchema). Типы input-DSL
// (string/int/bool/list/map и синонимы) нормализуются в простые типы формы.
// ADR-045 S4: enum/pattern/format/source пробрасываются для расширенного UI
// (SID-picker, pattern-валидация, dropdown).

const INT_TYPES = new Set(['int', 'integer', 'int64', 'int32']);
const NUMBER_TYPES = new Set(['number', 'float', 'float64', 'double']);
const BOOL_TYPES = new Set(['bool', 'boolean']);
// list/array → array; map/object → object (normalizeType).
// map дополнительно сохраняется флагом isMap для KEY→VALUE-редактора.
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
      // secret-флаг прокидываем для возможной маскировки/подсказки в UI.
      secret: Boolean(p.secret),
      // ADR-045: UI-форма расширений — enum/pattern/format/source/items.
      ...(p.enum != null ? { enum: p.enum } : {}),
      ...(p.pattern != null ? { pattern: p.pattern } : {}),
      ...(p.format != null ? { format: p.format } : {}),
      ...(p.source != null ? { source: p.source } : {}),
      // B3: multiline → textarea; example → placeholder.
      ...(p.multiline != null ? { multiline: p.multiline } : {}),
      ...(p.example != null ? { example: p.example } : {}),
      // B2: isMap сохраняет признак type=map (нормализован в object) для KEY→VALUE-редактора.
      ...(isMapRawType(p.type) ? { isMap: true } : {}),
      // S8b: items описывает тип элемента (list) или значения (map).
      ...(p.items != null ? { items: {
        type: normalizeType(p.items.type),
        format: p.items.format,
        pattern: p.items.pattern,
        source: p.items.source,
        enum: p.items.enum ?? undefined,
        // isMap для вложенного items (если elements тоже map).
        ...(isMapRawType(p.items.type) ? { isMap: true } : {}),
      } } : {}),
    };
  }
  return out;
}

// Re-export для использования в SidPicker без прямого импорта api/keeper.
export type { ModuleInputSource };

// Есть ли у модуля формализованные параметры (plugin-модули). Пустой массив —
// core-модуль без input-схемы (рендерим cmd-поля / dynamic builder).
export function hasParams(params: ModuleParam[] | undefined): boolean {
  return Array.isArray(params) && params.length > 0;
}
