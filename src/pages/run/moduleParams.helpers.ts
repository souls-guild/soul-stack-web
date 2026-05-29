import type { ModuleParam, ScenarioInputSchema } from '../../api/keeper';

// Маппинг ModuleParam[] (из каталога модулей) на flat-map ScenarioInputSchema,
// чтобы переиспользовать ScenarioInputFields + scenarioInputFields.helpers
// (serializeFields / missingRequiredFields / defaultsFromSchema). Типы input-DSL
// (string/int/bool/list/map и синонимы) нормализуются в простые типы формы;
// составные (list/map/array/object) → string-fallback (raw-ввод), как в
// scenario per-field builder.

const INT_TYPES = new Set(['int', 'integer', 'int64', 'int32']);
const NUMBER_TYPES = new Set(['number', 'float', 'float64', 'double']);
const BOOL_TYPES = new Set(['bool', 'boolean']);

function normalizeType(raw: string | undefined): string {
  const t = (raw ?? '').toLowerCase();
  if (INT_TYPES.has(t)) return 'integer';
  if (NUMBER_TYPES.has(t)) return 'number';
  if (BOOL_TYPES.has(t)) return 'boolean';
  // string + всё составное (list/map/...) → string-fallback (raw textbox).
  return 'string';
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
    };
  }
  return out;
}

// Есть ли у модуля формализованные параметры (plugin-модули). Пустой массив —
// core-модуль без input-схемы (рендерим cmd-поля / dynamic builder).
export function hasParams(params: ModuleParam[] | undefined): boolean {
  return Array.isArray(params) && params.length > 0;
}
