// Query language for operator-defined console groups.
//
// A group is a name plus a predicate over the connected VMs, so the operator
// decides what a group IS instead of picking from axes we happened to think of.
//
// Deliberately flat — conditions joined by all/any, no parens, no nesting. That
// keeps text and builder perfectly round-trippable: anything typed can be shown
// in the builder and anything built can be typed. Nesting would buy little for
// bucketing VMs and would leave the builder unable to represent half the
// language.
//
//   coven = payments and sid ~ mongo-.*
//   trait.tier = infra or choir = control
//
// Not CEL: this runs in the browser over an already-fetched soul list, and CEL
// would imply server semantics we cannot honour here.

import type { SoulListEntry } from '../../api/keeper';

export type QueryOp = '=' | '!=' | '~' | '!~';
export const QUERY_OPS: QueryOp[] = ['=', '!=', '~', '!~'];

export type JoinMode = 'and' | 'or';

export interface QueryCondition {
  // 'sid' | 'coven' | 'choir' | 'status' | 'transport' | 'trait.<key>'
  field: string;
  op: QueryOp;
  value: string;
}

export interface ParsedQuery {
  join: JoinMode;
  conditions: QueryCondition[];
}

export const EMPTY_QUERY: ParsedQuery = { join: 'and', conditions: [] };

export interface ParseResult {
  query: ParsedQuery | null;
  error: string | null;
}

const FIELD_RE = /^(sid|coven|choir|status|transport|trait\.[A-Za-z0-9_.-]+)$/;
// Longest first: `!=` and `!~` must win over `=` and `~`.
const OP_RE = /(!=|!~|=|~)/;

function unquote(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

function needsQuotes(v: string): boolean {
  // An empty value stays bare: it means "not filled in yet", and quoting it as
  // `""` would read as an intentional match on the empty string.
  return v !== '' && (/[\s"']/.test(v) || /\b(and|or)\b/i.test(v));
}

function quote(v: string): string {
  return needsQuotes(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}

// Splits on top-level ` and ` / ` or `, ignoring separators inside quotes.
function splitJoins(text: string): { parts: string[]; joins: string[] } {
  const parts: string[] = [];
  const joins: string[] = [];
  let buf = '';
  let quoteCh: string | null = null;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoteCh) {
      buf += ch;
      if (ch === quoteCh && text[i - 1] !== '\\') quoteCh = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quoteCh = ch;
      buf += ch;
      continue;
    }
    const rest = text.slice(i);
    const m = /^\s+(and|or)\s+/i.exec(rest);
    if (m) {
      parts.push(buf);
      joins.push(m[1].toLowerCase());
      buf = '';
      i += m[0].length - 1;
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  return { parts, joins };
}

export function parseQuery(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed === '') return { query: { ...EMPTY_QUERY }, error: null };

  if (trimmed.includes('(') || trimmed.includes(')')) {
    return { query: null, error: 'parentheses are not supported — combine with all/any instead' };
  }

  const { parts, joins } = splitJoins(trimmed);
  const distinct = new Set(joins);
  if (distinct.size > 1) {
    return { query: null, error: 'mixing and/or in one group is not supported — use one or the other' };
  }
  const join: JoinMode = joins[0] === 'or' ? 'or' : 'and';

  const conditions: QueryCondition[] = [];
  for (const part of parts) {
    const chunk = part.trim();
    if (chunk === '') return { query: null, error: 'empty condition' };

    const m = OP_RE.exec(chunk);
    if (!m || m.index === undefined) {
      return { query: null, error: `"${chunk}" is not a condition — expected field = value` };
    }
    const field = chunk.slice(0, m.index).trim();
    const op = m[0] as QueryOp;
    const value = unquote(chunk.slice(m.index + op.length));

    if (!FIELD_RE.test(field)) {
      return {
        query: null,
        error: `unknown field "${field}" — use sid, coven, choir, status, transport or trait.<key>`,
      };
    }
    // An empty value is INCOMPLETE, not invalid: the builder rewrites this
    // string on every keystroke, and rejecting it would tear the builder down
    // the moment someone clears a field to retype it. It matches nothing until
    // filled in (see evalCondition).
    if (value !== '' && (op === '~' || op === '!~')) {
      try {
        new RegExp(value);
      } catch {
        return { query: null, error: `"${value}" is not a valid regular expression` };
      }
    }
    conditions.push({ field, op, value });
  }

  return { query: { join, conditions }, error: null };
}

export function formatQuery(q: ParsedQuery): string {
  return q.conditions.map((c) => `${c.field} ${c.op} ${quote(c.value)}`).join(` ${q.join} `);
}

// Values a soul carries on a field. Several is normal — a host in two covens.
export function fieldValues(
  soul: SoulListEntry,
  field: string,
  choirsBySid: ReadonlyMap<string, string[]>,
): string[] {
  if (field === 'sid') return [soul.sid];
  if (field === 'coven') return soul.covens ?? [];
  if (field === 'choir') return choirsBySid.get(soul.sid) ?? [];
  if (field === 'status') return [soul.status];
  if (field === 'transport') return [soul.transport];
  if (field.startsWith('trait.')) {
    const raw = (soul.traits ?? {})[field.slice('trait.'.length)];
    if (raw === undefined || raw === null) return [];
    // A trait value is a scalar or a list of scalars (ADR-060).
    return Array.isArray(raw) ? raw.map(String) : [String(raw)];
  }
  return [];
}

// Anchored, like the scope form's VM-name field: an unanchored `x` would match
// every SID containing it and quietly over-group.
function matchesRegex(value: string, pattern: string): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`).test(value);
  } catch {
    return false;
  }
}

function evalCondition(
  soul: SoulListEntry,
  cond: QueryCondition,
  choirsBySid: ReadonlyMap<string, string[]>,
): boolean {
  // Unfinished condition — matches nothing, for either join. A group being
  // typed must not sweep up hosts on the way.
  if (cond.value === '') return false;
  const values = fieldValues(soul, cond.field, choirsBySid);
  switch (cond.op) {
    case '=':
      return values.includes(cond.value);
    case '!=':
      // "has no such value" — a host with no value at all satisfies it.
      return !values.includes(cond.value);
    case '~':
      return values.some((v) => matchesRegex(v, cond.value));
    case '!~':
      return !values.some((v) => matchesRegex(v, cond.value));
  }
}

// An empty query matches NOTHING. A group the operator has not finished
// defining must not silently swallow the whole wall.
export function evalQuery(
  soul: SoulListEntry,
  query: ParsedQuery,
  choirsBySid: ReadonlyMap<string, string[]>,
): boolean {
  if (query.conditions.length === 0) return false;
  return query.join === 'and'
    ? query.conditions.every((c) => evalCondition(soul, c, choirsBySid))
    : query.conditions.some((c) => evalCondition(soul, c, choirsBySid));
}

// Fields worth offering in the builder: the fixed axes plus whatever trait keys
// the connected VMs actually carry.
export function availableFields(
  souls: readonly SoulListEntry[],
  choirsBySid: ReadonlyMap<string, string[]>,
): string[] {
  const out = ['sid', 'coven'];
  if (choirsBySid.size > 0) out.push('choir');
  const traitKeys = new Set<string>();
  for (const s of souls) for (const k of Object.keys(s.traits ?? {})) traitKeys.add(k);
  for (const k of [...traitKeys].sort()) out.push(`trait.${k}`);
  out.push('status', 'transport');
  return out;
}

// Distinct values of a field across the connected VMs — the builder offers them
// as suggestions so the operator does not have to remember exact spellings.
export function fieldSuggestions(
  souls: readonly SoulListEntry[],
  field: string,
  choirsBySid: ReadonlyMap<string, string[]>,
): string[] {
  const seen = new Set<string>();
  for (const s of souls) for (const v of fieldValues(s, field, choirsBySid)) seen.add(v);
  return [...seen].sort();
}
