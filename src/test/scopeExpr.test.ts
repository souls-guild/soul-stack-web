import { describe, it, expect } from 'vitest';
import {
  serializeScope,
  parseScope,
  isValidScope,
  type ScopeNode,
} from '../pages/rbac/scopeExpr';

describe('serializeScope — canonical form (mirrors keeper scope_ast.go)', () => {
  const cases: Array<[ScopeNode, string]> = [
    [{ kind: 'cond', dim: 'coven', match: 'in', values: ['a'] }, 'coven=a'],
    [{ kind: 'cond', dim: 'coven', match: 'in', values: ['a', 'b'] }, 'coven in (a, b)'],
    [{ kind: 'cond', dim: 'host', match: 'matches', values: ['redis-*'] }, 'host matches redis-*'],
    [{ kind: 'cond', dim: 'trait', key: 'owner', match: 'in', values: ['dba'] }, 'trait.owner=dba'],
    [
      { kind: 'cond', dim: 'host', match: 'matches', values: ['a b'] },
      'host matches "a b"', // space → quoted
    ],
    [
      {
        kind: 'group',
        op: 'and',
        children: [
          { kind: 'cond', dim: 'coven', match: 'in', values: ['payments', 'checkout'] },
          { kind: 'cond', dim: 'host', match: 'matches', values: ['redis-*'] },
          {
            kind: 'group',
            op: 'or',
            children: [
              { kind: 'cond', dim: 'trait', key: 'owner', match: 'in', values: ['dba'] },
              { kind: 'cond', dim: 'trait', key: 'owner', match: 'in', values: ['platform'] },
            ],
          },
        ],
      },
      'coven in (payments, checkout) AND host matches redis-* AND (trait.owner=dba OR trait.owner=platform)',
    ],
  ];
  it.each(cases)('serializes %#', (tree, want) => {
    expect(serializeScope(tree)).toBe(want);
  });

  it('empty / single-child groups collapse', () => {
    expect(serializeScope(null)).toBe('');
    expect(serializeScope({ kind: 'group', op: 'and', children: [] })).toBe('');
    expect(
      serializeScope({
        kind: 'group',
        op: 'and',
        children: [{ kind: 'cond', dim: 'coven', match: 'in', values: ['x'] }],
      }),
    ).toBe('coven=x');
  });
});

describe('parseScope', () => {
  it('parses the old flat form coven=a,b as an in-list', () => {
    const n = parseScope('coven=a,b');
    expect(n).toEqual({ kind: 'cond', dim: 'coven', match: 'in', values: ['a', 'b'] });
  });
  it('parses host matches with a quoted glob', () => {
    expect(parseScope('host matches "redis-*"')).toEqual({
      kind: 'cond',
      dim: 'host',
      match: 'matches',
      values: ['redis-*'],
    });
  });
  it('precedence AND binds tighter than OR', () => {
    const n = parseScope('coven=a OR coven=b AND coven=c') as ScopeNode;
    expect(n.kind).toBe('group');
    if (n.kind === 'group') {
      expect(n.op).toBe('or');
      expect(n.children[1].kind).toBe('group');
    }
  });
  it('rejects removed selector types and bad forms', () => {
    for (const bad of ['regex=x', 'soulprint=x', 'state=x', 'coven', 'coven matches x', '(coven=a']) {
      expect(() => parseScope(bad)).toThrow();
    }
  });
});

describe('round-trip parse(serialize(tree)) preserves canonical trees', () => {
  const strings = [
    'coven=a',
    'coven in (a, b)',
    'host matches redis-*',
    'incarnation matches prod-*',
    'trait.owner=dba',
    'coven in (payments, checkout) AND host matches redis-* AND (trait.owner=dba OR trait.owner=platform)',
  ];
  it.each(strings)('round-trips %s', (s) => {
    expect(serializeScope(parseScope(s))).toBe(s);
  });
});

describe('isValidScope', () => {
  it('empty is valid (no scope)', () => expect(isValidScope('')).toBe(true));
  it('canonical is valid', () => expect(isValidScope('coven=a AND host matches web-*')).toBe(true));
  it('malformed is invalid', () => expect(isValidScope('regex=x')).toBe(false));
});
