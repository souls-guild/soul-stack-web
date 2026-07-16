// Target DSL UI -> API shape (ErrandRunTarget / Tide-target).
//
// UI supports 5 selection modes:
//   sids        — multi-select SID (FQDN).
//   coven       — list of Coven labels (chips).
//   glob        — `prod-*` (FQDN mask, sent as CEL `sid.glob("...")`).
//   regex       — `^db-[0-9]+$` (POSIX RE2, sent as `sid.matches("...")`).
//   cel_where   — raw CEL predicate.
//
// Backend (Errand multi-target and Tide invocation-time override) expects the
// shape `{ sids?: [...], coven?: [...], where?: "<CEL>" }`. Translator AND-merges
// all enabled modes via a `where` conjunction.

import type { ErrandRunTarget } from '../../api/keeper';
import i18n from '../../i18n';

// Pure functions (outside the React tree) use the global i18n instance.
const t = i18n.t.bind(i18n);

export type TargetMode = 'sids' | 'coven' | 'glob' | 'regex' | 'cel_where';

export interface TargetSpec {
  // Active modes (order does not matter; AND-merged into `where`).
  modes: ReadonlySet<TargetMode>;
  sids: string[];
  coven: string[];
  glob: string;
  regex: string;
  celWhere: string;
}

export const EMPTY_TARGET_SPEC: TargetSpec = {
  modes: new Set<TargetMode>(),
  sids: [],
  coven: [],
  glob: '',
  regex: '',
  celWhere: '',
};

// Escaping for substituting a string literal into CEL: backslash and double-quote.
// CEL requires no other escapes for a basic string literal.
function celString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// CEL AND-merge: if there are multiple where-predicates, join via `&&` with paren-wrapping.
function andMerge(parts: string[]): string | undefined {
  const nonEmpty = parts.filter((p) => p.trim().length > 0);
  if (nonEmpty.length === 0) return undefined;
  if (nonEmpty.length === 1) return nonEmpty[0];
  return nonEmpty.map((p) => `(${p})`).join(' && ');
}

export interface TranslateResult {
  target: ErrandRunTarget;
  // Non-fatal warnings (e.g. empty glob, empty sids list, etc).
  warnings: string[];
}

export function translateTarget(spec: TargetSpec): TranslateResult {
  const warnings: string[] = [];
  const whereParts: string[] = [];
  const target: ErrandRunTarget = {};

  if (spec.modes.has('sids')) {
    if (spec.sids.length === 0) {
      warnings.push(t('run:warnSidsEmpty'));
    } else {
      target.sids = [...spec.sids];
    }
  }

  if (spec.modes.has('coven')) {
    if (spec.coven.length === 0) {
      warnings.push(t('run:warnCovenEmpty'));
    } else {
      target.coven = [...spec.coven];
    }
  }

  if (spec.modes.has('glob')) {
    const g = spec.glob.trim();
    if (!g) warnings.push(t('run:warnGlobEmpty'));
    else whereParts.push(`sid.glob(${celString(g)})`);
  }

  if (spec.modes.has('regex')) {
    const r = spec.regex.trim();
    if (!r) warnings.push(t('run:warnRegexEmpty'));
    else whereParts.push(`sid.matches(${celString(r)})`);
  }

  if (spec.modes.has('cel_where')) {
    const w = spec.celWhere.trim();
    if (!w) warnings.push(t('run:warnCelWhereEmpty'));
    else whereParts.push(w);
  }

  const merged = andMerge(whereParts);
  if (merged !== undefined) target.where = merged;

  return { target, warnings };
}

// Short text summary for the preview-counter / submit button.
export function describeTarget(spec: TargetSpec): string {
  const parts: string[] = [];
  if (spec.modes.has('sids') && spec.sids.length > 0) parts.push(`${spec.sids.length} SID`);
  if (spec.modes.has('coven') && spec.coven.length > 0) parts.push(`coven=[${spec.coven.join(',')}]`);
  if (spec.modes.has('glob') && spec.glob.trim()) parts.push(`glob=${spec.glob.trim()}`);
  if (spec.modes.has('regex') && spec.regex.trim()) parts.push(`regex=${spec.regex.trim()}`);
  if (spec.modes.has('cel_where') && spec.celWhere.trim()) parts.push(`where=${spec.celWhere.trim()}`);
  return parts.length === 0 ? t('run:targetNotSet') : parts.join(' AND ');
}

// Checks whether anything actually defines a scope. Used to gate submit.
export function hasAnyTarget(spec: TargetSpec): boolean {
  if (spec.modes.has('sids') && spec.sids.length > 0) return true;
  if (spec.modes.has('coven') && spec.coven.length > 0) return true;
  if (spec.modes.has('glob') && spec.glob.trim()) return true;
  if (spec.modes.has('regex') && spec.regex.trim()) return true;
  if (spec.modes.has('cel_where') && spec.celWhere.trim()) return true;
  return false;
}

// CSV parser for target_sids/target_coven: trim + drop empty.
function splitCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Restores TargetSpec from URL search-params. Used by bulk-run actions from
// list pages (SoulsList / HostsTab / ServiceDetail) to pre-fill Wizard
// Step 3. Supported keys:
//   target_sids   — CSV of SIDs -> mode='sids'.
//   target_coven  — CSV of Coven labels -> mode='coven'.
//   target_glob   — FQDN mask -> mode='glob'.
//   target_regex  — RE2 -> mode='regex'.
//   target_where  — raw CEL -> mode='cel_where'.
// Multiple keys at once -> AND-merge (multiple active modes).
export function specFromQueryParams(params: URLSearchParams): TargetSpec {
  const modes = new Set<TargetMode>();
  const sidsRaw = params.get('target_sids');
  const covenRaw = params.get('target_coven');
  const globRaw = params.get('target_glob');
  const regexRaw = params.get('target_regex');
  const whereRaw = params.get('target_where');

  const sids = sidsRaw ? splitCsv(sidsRaw) : [];
  const coven = covenRaw ? splitCsv(covenRaw) : [];
  const glob = globRaw ?? '';
  const regex = regexRaw ?? '';
  const celWhere = whereRaw ?? '';

  if (sids.length > 0) modes.add('sids');
  if (coven.length > 0) modes.add('coven');
  if (glob.trim().length > 0) modes.add('glob');
  if (regex.trim().length > 0) modes.add('regex');
  if (celWhere.trim().length > 0) modes.add('cel_where');

  return { modes, sids, coven, glob, regex, celWhere };
}

// Whether a target-parameter was set in the query at all (so the wizard knows
// to jump to Step 3 skipping Step 2 when workload-params are already set).
export function queryHasTargetParams(params: URLSearchParams): boolean {
  return (
    params.has('target_sids') ||
    params.has('target_coven') ||
    params.has('target_glob') ||
    params.has('target_regex') ||
    params.has('target_where')
  );
}

// Filters from the Souls list page (status/transport/coven) + soulprint-DSL
// -> CEL fragment to pass to the Wizard via ?target_where=...
// status=connected         -> `status == "connected"`
// transport=agent          -> `transport == "agent"`
// coven=[prod,stage]       -> `("prod" in covens) || ("stage" in covens)`
// soulprint os.family=debian -> `soulprint.self.os.family == "debian"`
// AND-merge of all non-empty parts with paren-wrapping.
export interface SoulsFilterSnapshot {
  status?: string;
  transport?: string;
  covens?: string[];
  // Already-parsed soulprintFilter rules. Passed through as-is, without
  // re-parsing: SoulsList already validates syntax.
  soulprintRules?: ReadonlyArray<{ path: string; op: string; value: string | number }>;
  // SID-search (contains) — translated to sid.glob or sid.matches; here
  // we use substring via CEL `sid.contains(...)`. If empty — ignored.
  sidSearch?: string;
}

export function filtersToCEL(snap: SoulsFilterSnapshot): string {
  const parts: string[] = [];
  if (snap.status && snap.status.length > 0) {
    parts.push(`status == ${celString(snap.status)}`);
  }
  if (snap.transport && snap.transport.length > 0) {
    parts.push(`transport == ${celString(snap.transport)}`);
  }
  if (snap.covens && snap.covens.length > 0) {
    const orParts = snap.covens.map((c) => `${celString(c)} in covens`);
    parts.push(orParts.length === 1 ? orParts[0] : orParts.map((p) => `(${p})`).join(' || '));
  }
  if (snap.sidSearch && snap.sidSearch.trim().length > 0) {
    parts.push(`sid.contains(${celString(snap.sidSearch.trim())})`);
  }
  if (snap.soulprintRules && snap.soulprintRules.length > 0) {
    for (const rule of snap.soulprintRules) {
      const cel = soulprintRuleToCEL(rule);
      if (cel) parts.push(cel);
    }
  }
  return andMerge(parts) ?? '';
}

// Translation of a single soulprintFilter rule into CEL. Wildcard '*' -> matches(...).
// Semantics are simplified best-effort: the CEL backend itself decides whether
// it is allowed for where-targeting; here we only generate the fragment.
function soulprintRuleToCEL(rule: { path: string; op: string; value: string | number }): string | null {
  const path = `soulprint.self.${rule.path}`;
  const v = rule.value;
  if (typeof v === 'number') {
    switch (rule.op) {
      case '=': return `${path} == ${v}`;
      case '!=': return `${path} != ${v}`;
      case '>=': return `${path} >= ${v}`;
      case '<=': return `${path} <= ${v}`;
      default: return null;
    }
  }
  // String: wildcard -> matches with conversion of '*' -> '.*'.
  const isWildcard = v.includes('*');
  if (isWildcard) {
    const re = v.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const regexLit = celString(`^${re}$`);
    switch (rule.op) {
      case '=':
      case '~': return `${path}.matches(${regexLit})`;
      case '!=': return `!${path}.matches(${regexLit})`;
      default: return null;
    }
  }
  switch (rule.op) {
    case '=': return `${path} == ${celString(v)}`;
    case '!=': return `${path} != ${celString(v)}`;
    case '~': return `${path}.contains(${celString(v)})`;
    default: return null;
  }
}
