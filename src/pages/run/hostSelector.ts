// Rich host-selector для Command-workload Run Wizard.
//
// Оператор комбинирует несколько критериев; между РАЗНЫМИ критериями — AND,
// внутри списочного критерия (incarnations / covens) — OR. UI резолвит критерии
// в конкретный список SID client-side (через GET /v1/souls + soulprint-fetch) и
// шлёт явный `target: { sids: [...] }` в POST /v1/errand-runs — так обходим
// незавершённую backend target-алгебру.
//
// Критерии:
//   incarnations — список incarnation-имён; soul принадлежит incarnation, если
//                  имя incarnation есть в его coven[] (incarnation.name — корневой
//                  Coven-label, ADR-008).
//   covens       — список Coven-меток; OR внутри.
//   sidRegex     — RE2-паттерн на SID.
//   soulprint    — DSL-строка (soulprintFilter.ts), AND внутри.

import type { SoulListEntry, SoulprintFacts } from '../../api/keeper';
import { parseSoulprintFilter, applyFilter, type FilterRule } from '../souls/soulprintFilter';

export interface HostCriteria {
  incarnations: string[];
  covens: string[];
  sidRegex: string;
  soulprint: string;
}

export const EMPTY_HOST_CRITERIA: HostCriteria = {
  incarnations: [],
  covens: [],
  sidRegex: '',
  soulprint: '',
};

// Распознанные правила soulprint-DSL + невалидные токены (для inline-warn).
export interface ParsedSoulprint {
  rules: FilterRule[];
  invalid: string[];
}

export function parseCriteriaSoulprint(c: HostCriteria): ParsedSoulprint {
  if (!c.soulprint.trim()) return { rules: [], invalid: [] };
  return parseSoulprintFilter(c.soulprint);
}

// Нужен ли soulprint-fetch для резолва (дорогой per-SID запрос).
export function needsSoulprint(c: HostCriteria): boolean {
  return c.soulprint.trim().length > 0;
}

// Скомпилированный SID-regex или null (при пустом / невалидном паттерне).
export function compileSidRegex(raw: string): { re: RegExp | null; error: string | null } {
  const r = raw.trim();
  if (!r) return { re: null, error: null };
  try {
    return { re: new RegExp(r), error: null };
  } catch (err) {
    return { re: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// Соответствует ли soul «стабильным» критериям (incarnations / covens / sidRegex).
// soulprint в этой стадии НЕ проверяется — он требует отдельного fetch.
export function matchStableCriteria(
  soul: SoulListEntry,
  c: HostCriteria,
  compiledRegex: RegExp | null,
): boolean {
  const covens = soul.covens ?? [];
  if (c.incarnations.length > 0) {
    // incarnation.name — корневой coven-label.
    if (!c.incarnations.some((inc) => covens.includes(inc))) return false;
  }
  if (c.covens.length > 0) {
    if (!c.covens.some((cv) => covens.includes(cv))) return false;
  }
  if (compiledRegex) {
    if (!compiledRegex.test(soul.sid)) return false;
  }
  return true;
}

// Финальная проверка soulprint-правил (требует уже загруженных typed_facts).
export function matchSoulprint(facts: SoulprintFacts | undefined, rules: FilterRule[]): boolean {
  if (rules.length === 0) return true;
  if (!facts) return false;
  return applyFilter(facts, rules);
}

// Активен ли хоть один критерий (для блокировки submit при пустом scope).
export function hasAnyCriteria(c: HostCriteria): boolean {
  return (
    c.incarnations.length > 0 ||
    c.covens.length > 0 ||
    c.sidRegex.trim().length > 0 ||
    c.soulprint.trim().length > 0
  );
}
