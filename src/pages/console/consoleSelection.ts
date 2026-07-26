// Console scope: what a link can pre-fill, and how a live scope reads back.
//
// The scope itself is the Run Wizard's HostCriteria (src/pages/run/hostSelector.ts)
// — incarnation / coven / SID regex / soulprint — so the two entry points into
// "which VMs" behave identically and the same DSL works in both.

import { EMPTY_HOST_CRITERIA, type HostCriteria } from '../run/hostSelector';

// Above this the wall fights both the browser and the operator: PTY sessions are
// meant for tens, not hundreds. A warning, never a block.
export const CONSOLE_SOFT_LIMIT = 12;

function splitCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Pre-fills the scope form from a link (bulk action from a list page, or a
// hand-written URL). Returns null when the link says nothing about scope, so
// the caller can tell "no intent" from "empty criteria".
//
// Accepts the wizard's target_* vocabulary plus `incarnation`, so links already
// pointing at a run target work unchanged. `target_where` (raw CEL) is NOT
// mapped: the browser cannot evaluate it, and silently dropping it would open
// shells on a wider set than the link asked for.
export function criteriaFromQuery(params: URLSearchParams): HostCriteria | null {
  const incarnation = params.get('incarnation');
  const incarnations = params.get('target_incarnations');
  const covens = params.get('target_coven');
  const sids = params.get('target_sids');
  const regex = params.get('target_regex');
  const glob = params.get('target_glob');
  const soulprint = params.get('target_soulprint');

  if (!incarnation && !incarnations && !covens && !sids && !regex && !glob && !soulprint) return null;

  const next: HostCriteria = {
    ...EMPTY_HOST_CRITERIA,
    incarnations: [...(incarnation ? [incarnation] : []), ...(incarnations ? splitCsv(incarnations) : [])],
    covens: covens ? splitCsv(covens) : [],
    sidRegex: regex ?? '',
    soulprint: soulprint ?? '',
  };

  // An explicit SID list and a glob both become a SID pattern: the scope form
  // has one SID axis, and an alternation of anchored literals is exactly it.
  const patterns: string[] = [];
  if (sids) patterns.push(...splitCsv(sids).map(escapeRegex));
  if (glob) patterns.push(globToRegexSource(glob.trim()));
  if (patterns.length > 0 && !next.sidRegex) {
    next.sidRegex = patterns.length === 1 ? patterns[0] : patterns.map((p) => `(?:${p})`).join('|');
  }
  return next;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// FQDN mask -> regex source. Only `*` is special, as in the wizard's glob mode.
export function globToRegexSource(glob: string): string {
  return glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
}

// Human-readable chips for the scope bar above a live session.
export function describeCriteria(c: HostCriteria): string[] {
  const out: string[] = [];
  if (c.incarnations.length > 0) out.push(`incarnation=${c.incarnations.join(',')}`);
  if (c.covens.length > 0) out.push(`coven=${c.covens.join(',')}`);
  if (c.sidRegex.trim()) out.push(`sid~${c.sidRegex.trim()}`);
  if (c.soulprint.trim()) out.push(c.soulprint.trim());
  return out;
}
