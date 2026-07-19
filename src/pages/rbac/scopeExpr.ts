// Boolean RBAC scope expression (NIM-128) — the client mirror of the keeper
// grammar (keeper/internal/rbac/scope_ast.go). A role/permission scope is a
// boolean predicate over five dimensions — coven / service / incarnation /
// host / trait — joined by AND/OR with grouping. This module is the single
// source of truth for the wire contract on the client: the condition-builder
// edits a ScopeNode tree, `serializeScope` turns it into the CANONICAL string
// that keeper parses, and `parseScope` loads an existing scope string back
// into a tree for editing (with a raw-string fallback when it can't).
//
// Canonical form (must round-trip 1:1 with the server):
//   coven in (payments, checkout) AND host matches "redis-*" AND (trait.owner=dba OR trait.owner=platform)
// A single exact value renders `dim=v`; multiple render `dim in (v1, v2)`.
// Values with characters outside the bare class are double-quoted.

export type ScopeDim = 'coven' | 'service' | 'incarnation' | 'host' | 'trait';

export const SCOPE_DIMS: ScopeDim[] = ['coven', 'service', 'incarnation', 'host', 'trait'];

/** `in` = exact value set (one value or a comma list, OR within the key); `matches` = host glob. */
export type CondMatch = 'in' | 'matches';

export interface ScopeCond {
  kind: 'cond';
  dim: ScopeDim;
  /** trait key (dim === 'trait' only). */
  key?: string;
  match: CondMatch;
  /** exact set (>= 1 for `in`); a single glob for `matches`. */
  values: string[];
}

export interface ScopeGroup {
  kind: 'group';
  op: 'and' | 'or';
  children: ScopeNode[];
}

export type ScopeNode = ScopeCond | ScopeGroup;

// Character classes shared with the server (scope_ast.go reScopeExact / reScopeGlob).
const RE_EXACT = /^[A-Za-z0-9_.-]+$/;
const RE_GLOB = /^[A-Za-z0-9_.*?-]+$/;
const RE_TRAIT_KEY = /^[a-z][a-z0-9_.-]*$/;

/** Quote an exact value unless it matches the bare class. */
function q(v: string): string {
  return RE_EXACT.test(v) ? v : `"${v}"`;
}

/** Quote a glob unless it matches the bare glob class. */
function qGlob(v: string): string {
  return RE_GLOB.test(v) ? v : `"${v}"`;
}

/** Serialize a condition to its canonical string. */
function serializeCond(c: ScopeCond): string {
  if (c.dim === 'trait') {
    return `trait.${c.key ?? ''}=${q(c.values[0] ?? '')}`;
  }
  if (c.match === 'matches') {
    // glob is valid for host and incarnation (NIM-128 amendment).
    return `${c.dim} matches ${qGlob(c.values[0] ?? '')}`;
  }
  if (c.values.length === 1) {
    return `${c.dim}=${q(c.values[0])}`;
  }
  return `${c.dim} in (${c.values.map(q).join(', ')})`;
}

/**
 * Serialize a scope tree to the canonical string keeper parses. A nested group
 * (a group child of a group) is parenthesized; a single-child group unwraps to
 * its child. Returns '' for an empty tree (= no scope / unrestricted).
 */
export function serializeScope(node: ScopeNode | null | undefined): string {
  if (!node) return '';
  if (node.kind === 'cond') return serializeCond(node);
  const kids = node.children.filter(Boolean);
  if (kids.length === 0) return '';
  if (kids.length === 1) return serializeScope(kids[0]);
  const sep = node.op === 'and' ? ' AND ' : ' OR ';
  return kids
    .map((c) => (c.kind === 'group' && c.children.filter(Boolean).length > 1 ? `(${serializeScope(c)})` : serializeScope(c)))
    .join(sep);
}

// --- parser (mirror of scope_ast.go recursive descent) ---

type Tok = { t: 'word' | 'quoted' | '(' | ')' | ',' | '=' | 'eof'; v: string };

function lex(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const isWord = (c: string) => /[A-Za-z0-9_.*?-]/.test(c);
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
    } else if (c === '(' || c === ')' || c === ',' || c === '=') {
      out.push({ t: c as Tok['t'], v: c });
      i++;
    } else if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j++;
      if (j >= s.length) throw new Error('unterminated quote');
      out.push({ t: 'quoted', v: s.slice(i + 1, j) });
      i = j + 1;
    } else if (isWord(c)) {
      let j = i;
      while (j < s.length && isWord(s[j])) j++;
      out.push({ t: 'word', v: s.slice(i, j) });
      i = j;
    } else {
      throw new Error(`unexpected char ${c}`);
    }
  }
  out.push({ t: 'eof', v: '' });
  return out;
}

class P {
  private i = 0;
  constructor(private toks: Tok[]) {}
  private peek() {
    return this.toks[this.i];
  }
  private next() {
    const t = this.toks[this.i];
    if (this.i < this.toks.length - 1) this.i++;
    return t;
  }
  private isKw(kw: string) {
    const t = this.peek();
    return t.t === 'word' && t.v.toLowerCase() === kw;
  }
  parse(): ScopeNode {
    const e = this.or();
    if (this.peek().t !== 'eof') throw new Error(`trailing ${this.peek().v}`);
    return e;
  }
  private or(): ScopeNode {
    const terms = [this.and()];
    while (this.isKw('or')) {
      this.next();
      terms.push(this.and());
    }
    return terms.length === 1 ? terms[0] : { kind: 'group', op: 'or', children: terms };
  }
  private and(): ScopeNode {
    const terms = [this.factor()];
    while (this.isKw('and')) {
      this.next();
      terms.push(this.factor());
    }
    return terms.length === 1 ? terms[0] : { kind: 'group', op: 'and', children: terms };
  }
  private factor(): ScopeNode {
    if (this.peek().t === '(') {
      this.next();
      const e = this.or();
      if (this.peek().t !== ')') throw new Error("expected ')'");
      this.next();
      return e;
    }
    return this.cond();
  }
  private value(): string {
    const t = this.next();
    if (t.t === 'quoted' || t.t === 'word') return t.v;
    throw new Error('expected value');
  }
  private valueList(): string[] {
    const out = [this.value()];
    while (this.peek().t === ',') {
      this.next();
      out.push(this.value());
    }
    return out;
  }
  private cond(): ScopeCond {
    const w = this.peek();
    if (w.t !== 'word') throw new Error('expected condition');
    if (w.v.toLowerCase() === 'and' || w.v.toLowerCase() === 'or') throw new Error('expected condition');
    this.next();
    if (w.v.startsWith('trait.')) {
      const key = w.v.slice('trait.'.length);
      if (!RE_TRAIT_KEY.test(key)) throw new Error('bad trait key');
      if (this.peek().t !== '=') throw new Error("trait needs '='");
      this.next();
      return { kind: 'cond', dim: 'trait', key, match: 'in', values: [this.value()] };
    }
    const dim = w.v as ScopeDim;
    if (!SCOPE_DIMS.includes(dim) || dim === 'trait') throw new Error(`unknown dimension ${w.v}`);
    if (this.peek().t === '=') {
      this.next();
      return { kind: 'cond', dim, match: 'in', values: this.valueList() };
    }
    if (this.isKw('in')) {
      this.next();
      if (this.peek().t !== '(') throw new Error("'in' needs '('");
      this.next();
      const vals = this.valueList();
      if (this.peek().t !== ')') throw new Error("expected ')'");
      this.next();
      return { kind: 'cond', dim, match: 'in', values: vals };
    }
    if (this.isKw('matches')) {
      if (dim !== 'host' && dim !== 'incarnation') throw new Error('matches only for host or incarnation');
      this.next();
      return { kind: 'cond', dim, match: 'matches', values: [this.value()] };
    }
    throw new Error(`expected '=', 'in', or 'matches' after ${dim}`);
  }
}

/**
 * Parse a scope string into a tree. Returns null for an empty string. Throws on
 * a malformed expression — callers should catch and fall back to a raw-string
 * edit affordance (graceful degradation).
 */
export function parseScope(s: string): ScopeNode | null {
  const trimmed = s.trim();
  if (trimmed === '') return null;
  return new P(lex(trimmed)).parse();
}

/** True if the string parses as a valid boolean scope (soft client check; the server is authoritative). */
export function isValidScope(s: string): boolean {
  if (s.trim() === '') return true;
  try {
    parseScope(s);
    return true;
  } catch {
    return false;
  }
}

// --- convenience constructors for the builder ---

export function emptyCond(dim: ScopeDim = 'coven'): ScopeCond {
  return { kind: 'cond', dim, match: 'in', values: [''] };
}

export function emptyGroup(op: 'and' | 'or' = 'and'): ScopeGroup {
  return { kind: 'group', op, children: [emptyCond()] };
}
