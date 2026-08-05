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
//   excluded     — hosts the operator dropped from the resolved set (see below).

import type { SoulListEntry, SoulprintFacts } from '../../api/keeper';
import { parseSoulprintFilter, applyFilter, type FilterRule } from '../souls/soulprintFilter';

export interface HostCriteria {
  incarnations: string[];
  covens: string[];
  sidRegex: string;
  soulprint: string;
  // Removals from the resolved set, not a selection. The criteria keep resolving on
  // their own, so an entry that no longer matches anything is inert instead of
  // silently shrinking a target the operator re-scoped later.
  excluded: string[];
}

export const EMPTY_HOST_CRITERIA: HostCriteria = {
  incarnations: [],
  covens: [],
  sidRegex: '',
  soulprint: '',
  excluded: [],
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

// Candidates the soulprint stage will fan out over — it reads one host at a time,
// so its cost IS the candidate count.
//
// 1000 is what the ceiling already was: both callers used to resolve against a
// single page of `GET /v1/souls`, so nothing that worked before this reaches it.
// Since NIM-448 they read the whole registry, and a fleet of tens of thousands
// would otherwise put a request and a react-query observer behind every host.
// Past the limit the criterion is REFUSED, not applied to part of the candidates:
// the reason for reading the whole registry is that the operator is never handed
// a target quietly narrower than the criteria describe.
export const SOULPRINT_FANOUT_LIMIT = 1000;

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

// Whether any criterion is active (to block submit on empty scope). Exclusions do
// not count — dropping hosts narrows a target, it never defines one.
export function hasAnyCriteria(c: HostCriteria): boolean {
  return (
    c.incarnations.length > 0 ||
    c.covens.length > 0 ||
    c.sidRegex.trim().length > 0 ||
    c.soulprint.trim().length > 0
  );
}

// The resolved hosts that survive the operator's exclusions — the actual run target.
export function applyExclusions(resolved: string[], c: HostCriteria): string[] {
  if (c.excluded.length === 0) return resolved;
  const dropped = new Set(c.excluded);
  return resolved.filter((sid) => !dropped.has(sid));
}

// The exclusions that actually bite right now (∩ with what the criteria resolve to).
// Callers gate on this rather than on `excluded.length`, so a leftover entry from an
// earlier criteria set does not, say, silently turn a late-binding target into a snapshot.
export function activeExclusions(resolved: string[], c: HostCriteria): string[] {
  if (c.excluded.length === 0) return [];
  const dropped = new Set(c.excluded);
  return resolved.filter((sid) => dropped.has(sid));
}

// The rows the Hosts step can act on: the head of the resolution, plus every dropped host
// past it. The list is capped so a thousand-host resolution does not become a thousand
// checkboxes — but a host the operator cannot reach is a host they cannot put back, so a
// removal is never allowed to hide below the cap. The "and N more" counter stays honest
// because it counts what is NOT rendered (total minus these rows).
export function visibleHostRows<T extends { sid: string }>(
  resolved: readonly T[],
  c: HostCriteria,
  limit = 50,
): T[] {
  const head = resolved.slice(0, limit);
  if (c.excluded.length === 0) return head;
  const dropped = new Set(c.excluded);
  const shown = new Set(head.map((row) => row.sid));
  return [...head, ...resolved.slice(limit).filter((row) => dropped.has(row.sid) && !shown.has(row.sid))];
}

// The pre-flight target, encoded as a string so the query key changes only when the target
// settles, and decoded back. Producer and parser live together on purpose: a parser that
// drifts from its producer reads an answer as being about a target it was never about.
export function previewTargetKeyForSids(sids: string[], module: string): string {
  return JSON.stringify({ sids, module });
}

export function sidsFromPreviewKey(key: string | null): string[] {
  if (key === null) return [];
  try {
    const asked = JSON.parse(key) as { sids?: unknown };
    return Array.isArray(asked.sids) ? (asked.sids as string[]) : [];
  } catch {
    return [];
  }
}

// Which of the hosts WE asked for the backend named in a refusal.
//
// The pre-flight 403 carries the offending SID inside a prose detail, so this does not
// parse the sentence — it looks for a target SID inside it. A reworded message degrades
// to "no host identified" (the text is still shown to the operator), never to the wrong
// host. Longest match first: one SID can contain another, as FQDNs routinely do
// (`redis.example.com` sits inside `my-redis.example.com`).
export function deniedHostFromDetail(detail: string, targetSids: string[]): string | null {
  if (!detail) return null;
  const byLength = [...targetSids].sort((a, b) => b.length - a.length);
  return byLength.find((sid) => sid.length > 0 && detail.includes(sid)) ?? null;
}
