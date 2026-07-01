// Чистые функции client-side мультиселект-фильтра coven+traits (вынесены из
// CovenTraitsFilter.tsx — react-refresh/only-export-components требует
// не смешивать non-component экспорты с компонентом в одном файле).

import type { IncarnationGetReply } from '../../api/keeper';

/** `key=value` пара trait, сериализованная для выбора в мультиселекте. */
export type TraitFilterOption = string;

export interface CovenTraitsFilterValue {
  covens: string[];
  traits: TraitFilterOption[];
}

export const EMPTY_COVEN_TRAITS_FILTER: CovenTraitsFilterValue = { covens: [], traits: [] };

function traitValueToOptions(val: unknown): string[] {
  if (Array.isArray(val)) return val.map((v) => String(v));
  return [String(val)];
}

/** Извлекает уникальные `key=value` опции traits из подгруженных инкарнаций. */
export function collectTraitOptions(items: IncarnationGetReply[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const traits = item.traits as Record<string, unknown> | null | undefined;
    if (!traits || typeof traits !== 'object') continue;
    for (const [key, val] of Object.entries(traits)) {
      for (const v of traitValueToOptions(val)) {
        set.add(`${key}=${v}`);
      }
    }
  }
  return [...set].sort();
}

export function collectCovenOptions(items: IncarnationGetReply[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    for (const c of item.covens ?? []) set.add(c);
  }
  return [...set].sort();
}

/** item матчит выбранный набор coven/traits (AND между coven и traits, AND внутри traits). */
export function matchesCovenTraitsFilter(
  item: IncarnationGetReply,
  filter: CovenTraitsFilterValue,
): boolean {
  if (filter.covens.length > 0) {
    const itemCovens = item.covens ?? [];
    if (!filter.covens.some((c) => itemCovens.includes(c))) return false;
  }
  if (filter.traits.length > 0) {
    const traits = (item.traits as Record<string, unknown> | null | undefined) ?? {};
    const itemPairs = new Set<string>();
    for (const [key, val] of Object.entries(traits)) {
      for (const v of traitValueToOptions(val)) itemPairs.add(`${key}=${v}`);
    }
    if (!filter.traits.every((pair) => itemPairs.has(pair))) return false;
  }
  return true;
}
