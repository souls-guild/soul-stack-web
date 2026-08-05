// Rich host-selector for the Command-workload Run Wizard.
//
// The operator combines several criteria; between DIFFERENT criteria — AND,
// within a list criterion (incarnations / covens) — OR. The UI resolves criteria
// into a concrete SID list client-side (via GET /v1/souls + soulprint-fetch) and
// sends an explicit `target: { sids: [...] }` in POST /v1/errand-runs — this works
// around the incomplete backend target algebra.
//
// Criteria:
//   incarnations — list of incarnation names; a soul belongs to an incarnation
//                  when the roster says so (`incarnation_membership`, NIM-124),
//                  resolved by useIncarnationMembers and passed in as a SID set.
//                  NOT a label question: see that file for why the two diverge.
//   covens       — list of Coven labels; OR within.
//   sidRegex     — RE2 pattern over SID, full-match (anchored `^(?:...)$`, like `grep -x`).
//   soulprint    — DSL string (soulprintFilter.ts), AND within.

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

// Recognized soulprint-DSL rules + invalid tokens (for inline-warn).
export interface ParsedSoulprint {
  rules: FilterRule[];
  invalid: string[];
}

export function parseCriteriaSoulprint(c: HostCriteria): ParsedSoulprint {
  if (!c.soulprint.trim()) return { rules: [], invalid: [] };
  return parseSoulprintFilter(c.soulprint);
}

// Whether a soulprint-fetch is needed for resolution (expensive per-SID request).
export function needsSoulprint(c: HostCriteria): boolean {
  return c.soulprint.trim().length > 0;
}

// Compiled SID regex or null (for an empty / invalid pattern).
//
// The pattern is a full-match over SID (anchored `^(?:...)$`, `grep -x` semantics): otherwise
// an unanchored `x*` ("zero-or-more x") matches the empty substring in EVERY
// SID and targets all souls. Anchored via a non-capturing group so it doesn't
// break top-level alternation (`a|b` -> `^(?:a|b)$`, not `^a|b$`).
export function compileSidRegex(raw: string): { re: RegExp | null; error: string | null } {
  const r = raw.trim();
  if (!r) return { re: null, error: null };
  try {
    return { re: new RegExp(`^(?:${r})$`), error: null };
  } catch (err) {
    return { re: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// Whether the soul matches the "stable" criteria (incarnations / covens / sidRegex).
// soulprint is NOT checked at this stage — it requires a separate fetch.
//
// `memberSids` is the union of the rosters of `c.incarnations`
// (useIncarnationMembers). It is a required argument rather than an optional one
// so that a call site cannot quietly fall back to the coven column NIM-449 took
// this criterion off. While the rosters are in flight the set is empty and the
// criterion matches nothing — the caller reports "resolving", never "no hosts".
export function matchStableCriteria(
  soul: SoulListEntry,
  c: HostCriteria,
  compiledRegex: RegExp | null,
  memberSids: ReadonlySet<string>,
): boolean {
  const covens = soul.covens ?? [];
  if (c.incarnations.length > 0) {
    if (!memberSids.has(soul.sid)) return false;
  }
  if (c.covens.length > 0) {
    if (!c.covens.some((cv) => covens.includes(cv))) return false;
  }
  if (compiledRegex) {
    if (!compiledRegex.test(soul.sid)) return false;
  }
  return true;
}

// Final check of soulprint rules (requires typed_facts already loaded).
export function matchSoulprint(facts: SoulprintFacts | undefined, rules: FilterRule[]): boolean {
  if (rules.length === 0) return true;
  if (!facts) return false;
  return applyFilter(facts, rules);
}

// Whether any criterion is active (to block submit on empty scope).
export function hasAnyCriteria(c: HostCriteria): boolean {
  return (
    c.incarnations.length > 0 ||
    c.covens.length > 0 ||
    c.sidRegex.trim().length > 0 ||
    c.soulprint.trim().length > 0
  );
}
