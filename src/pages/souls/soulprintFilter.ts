// Parser and evaluator for the client-side filter over Soulprint facts (ADR-018).
//
// The DSL is intentionally simple and unlike CEL: the operator searches for
// "os.family=debian" rather than writing a full predicate. If a server-side
// filter turns out to be needed later -- the frontend will switch, but the
// user-facing syntax stays the same.
//
// Rule grammar:
//   <path><op><value>
// where
//   path  := dotted path into SoulprintFacts (os.family, kernel.version, memory.total_mb, ...).
//   op    := = | != | >= | <= | ~          (~  -- wildcard / contains)
//   value := string or number (auto-detect: parseFloat if the string is entirely numeric).
// Multiple rules are joined with ' & ' or whitespace -- AND.
// Wildcard in string values: `*` -> any substring. `6.*` == startsWith('6.').
//
// evalRule for unknown paths -> false (the rule does not match), no throw -- the UX
// quietly excludes the host instead of failing with an error.

export type FilterOp = '=' | '!=' | '>=' | '<=' | '~';

export interface FilterRule {
  path: string;
  op: FilterOp;
  value: string | number;
}

export interface ParseResult {
  rules: FilterRule[];
  invalid: string[];
}

// Order matters: check '!=' / '>=' / '<=' BEFORE '='.
const OPS: FilterOp[] = ['!=', '>=', '<=', '~', '='];

export function parseSoulprintFilter(input: string): ParseResult {
  const rules: FilterRule[] = [];
  const invalid: string[] = [];
  const tokens = input
    .split(/[&\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  for (const tok of tokens) {
    const rule = parseRule(tok);
    if (rule) rules.push(rule);
    else invalid.push(tok);
  }
  return { rules, invalid };
}

function parseRule(token: string): FilterRule | null {
  for (const op of OPS) {
    const idx = token.indexOf(op);
    if (idx <= 0) continue;
    const path = token.slice(0, idx).trim();
    const raw = token.slice(idx + op.length).trim();
    if (!path || !raw) return null;
    // Numeric compare only makes sense for numeric values.
    if (op === '>=' || op === '<=') {
      const num = Number(raw);
      if (Number.isNaN(num)) return null;
      return { path, op, value: num };
    }
    // = / != / ~ : auto-detect number vs string. Wildcard '*' -- always a string.
    if (!raw.includes('*') && raw !== '' && !Number.isNaN(Number(raw))) {
      return { path, op, value: Number(raw) };
    }
    return { path, op, value: raw };
  }
  return null;
}

// Fetches a value by dotted path, undefined if the branch is absent.
function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

// Wildcard mask `6.*` / `10.0.*` -> segment-wise "contains" string match.
function matchWildcard(actual: string, mask: string): boolean {
  if (!mask.includes('*')) return actual === mask;
  // Escape regex metacharacters except '*'.
  const escaped = mask.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(actual);
}

export function evalRule(soulprint: unknown, rule: FilterRule): boolean {
  const actual = getByPath(soulprint, rule.path);
  if (actual === undefined || actual === null) return false;

  switch (rule.op) {
    case '=': {
      if (typeof rule.value === 'number') {
        return typeof actual === 'number' && actual === rule.value;
      }
      // Wildcard or exact, both via matchWildcard.
      return matchWildcard(String(actual), rule.value);
    }
    case '!=': {
      if (typeof rule.value === 'number') {
        return typeof actual === 'number' && actual !== rule.value;
      }
      return !matchWildcard(String(actual), rule.value);
    }
    case '~': {
      // Substring / wildcard. If the mask has no '*' -- substring.
      const v = String(rule.value);
      const a = String(actual);
      if (v.includes('*')) return matchWildcard(a, v);
      return a.toLowerCase().includes(v.toLowerCase());
    }
    case '>=': {
      const num = typeof actual === 'number' ? actual : Number(actual);
      if (Number.isNaN(num)) return false;
      return num >= (rule.value as number);
    }
    case '<=': {
      const num = typeof actual === 'number' ? actual : Number(actual);
      if (Number.isNaN(num)) return false;
      return num <= (rule.value as number);
    }
  }
}

export function applyFilter(soulprint: unknown, rules: FilterRule[]): boolean {
  if (rules.length === 0) return true;
  for (const r of rules) {
    if (!evalRule(soulprint, r)) return false;
  }
  return true;
}
