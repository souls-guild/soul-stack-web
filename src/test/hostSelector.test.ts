import { describe, it, expect } from 'vitest';
import { compileSidRegex, matchStableCriteria, EMPTY_HOST_CRITERIA } from '../pages/run/hostSelector';
import type { SoulListEntry } from '../api/keeper';

function soul(sid: string, covens: string[] = []): SoulListEntry {
  return { sid, covens } as SoulListEntry;
}

// No incarnation criterion in play → the roster set is irrelevant.
const NO_MEMBERS: ReadonlySet<string> = new Set<string>();

describe('compileSidRegex — anchored full-match', () => {
  it('empty pattern → null without error', () => {
    expect(compileSidRegex('')).toEqual({ re: null, error: null });
    expect(compileSidRegex('   ')).toEqual({ re: null, error: null });
  });

  it('`x*` does NOT match a real SID (unanchored bug)', () => {
    const { re, error } = compileSidRegex('x*');
    expect(error).toBeNull();
    expect(re).not.toBeNull();
    expect(re!.test('soul-aws-01')).toBe(false);
    // `x*` = zero-or-more x -> matches only strings made of x (incl. empty).
    expect(re!.test('xxx')).toBe(true);
    expect(re!.test('')).toBe(true);
  });

  it('`soul-aws-.*` matches the corresponding SID', () => {
    const { re } = compileSidRegex('soul-aws-.*');
    expect(re!.test('soul-aws-01')).toBe(true);
    expect(re!.test('soul-gcp-01')).toBe(false);
  });

  it('full name matches exactly and only itself', () => {
    const { re } = compileSidRegex('soul-aws-01');
    expect(re!.test('soul-aws-01')).toBe(true);
    expect(re!.test('soul-aws-011')).toBe(false);
    expect(re!.test('x-soul-aws-01')).toBe(false);
  });

  it('top-level alternation is anchored as a whole (a|b → ^(?:a|b)$)', () => {
    const { re } = compileSidRegex('host-a|host-b');
    expect(re!.test('host-a')).toBe(true);
    expect(re!.test('host-b')).toBe(true);
    // Without a non-capturing group, `^host-a|host-b$` would falsely match 'host-a-extra'.
    expect(re!.test('host-a-extra')).toBe(false);
    expect(re!.test('prefix-host-b')).toBe(false);
  });

  it('invalid regex → error, re=null (does not crash, does not match everything)', () => {
    const { re, error } = compileSidRegex('[');
    expect(re).toBeNull();
    expect(error).toBeTruthy();
  });
});

describe('matchStableCriteria — sidRegex applied via compiled re', () => {
  const souls = [soul('soul-aws-01'), soul('soul-aws-02'), soul('soul-gcp-01')];

  it('`x*` does NOT target all souls', () => {
    const c = { ...EMPTY_HOST_CRITERIA, sidRegex: 'x*' };
    const { re } = compileSidRegex(c.sidRegex);
    const matched = souls.filter((s) => matchStableCriteria(s, c, re, NO_MEMBERS));
    expect(matched).toHaveLength(0);
  });

  it('`soul-aws-.*` targets only aws', () => {
    const c = { ...EMPTY_HOST_CRITERIA, sidRegex: 'soul-aws-.*' };
    const { re } = compileSidRegex(c.sidRegex);
    const matched = souls.filter((s) => matchStableCriteria(s, c, re, NO_MEMBERS));
    expect(matched.map((s) => s.sid)).toEqual(['soul-aws-01', 'soul-aws-02']);
  });

  it('invalid regex (re=null) → regex criterion disabled', () => {
    const c = { ...EMPTY_HOST_CRITERIA, sidRegex: '[' };
    const { re } = compileSidRegex(c.sidRegex);
    expect(re).toBeNull();
    // re=null -> the regex criterion is not applied; but the caller blocks submit on
    // regexError, so "all hosts" never gets sent to the operator.
    const matched = souls.filter((s) => matchStableCriteria(s, c, re, NO_MEMBERS));
    expect(matched).toHaveLength(souls.length);
  });
});

// NIM-449. Membership is `incarnation_membership`, not the coven column — and an
// incarnation's name being a label its members inherit is exactly what made the
// two look interchangeable. Every fixture here has them disagree, so a resolver
// that went back to reading `souls.coven` fails on the SIDs, not just the count.
describe('matchStableCriteria — the incarnations criterion is membership, not a label', () => {
  const c = { ...EMPTY_HOST_CRITERIA, incarnations: ['redis-prod'] };
  // Bound to redis-prod, carries only its own tag.
  const memberNoLabel = soul('db-1.example.com', ['prod']);
  // Carries the incarnation's name as a plain label; never bound to it.
  const labelNoMember = soul('web-1.example.com', ['redis-prod']);
  const roster: ReadonlySet<string> = new Set([memberNoLabel.sid]);

  it('a member without the label IS targeted', () => {
    expect(matchStableCriteria(memberNoLabel, c, null, roster)).toBe(true);
  });

  it('a non-member carrying the label is NOT targeted', () => {
    expect(matchStableCriteria(labelNoMember, c, null, roster)).toBe(false);
  });

  it('several incarnations OR together over the union of their rosters', () => {
    const both = { ...EMPTY_HOST_CRITERIA, incarnations: ['redis-prod', 'redis-stage'] };
    const union: ReadonlySet<string> = new Set(['db-1.example.com', 'db-9.example.com']);
    const stageMember = soul('db-9.example.com', []);
    expect(matchStableCriteria(memberNoLabel, both, null, union)).toBe(true);
    expect(matchStableCriteria(stageMember, both, null, union)).toBe(true);
    expect(matchStableCriteria(labelNoMember, both, null, union)).toBe(false);
  });

  it('ANDs with the other criteria — membership alone is not enough', () => {
    const withCoven = { ...c, covens: ['db'] };
    expect(matchStableCriteria(memberNoLabel, withCoven, null, roster)).toBe(false);
    expect(matchStableCriteria(soul('db-1.example.com', ['db']), withCoven, null, roster)).toBe(true);

    const { re } = compileSidRegex('web-.*');
    expect(matchStableCriteria(memberNoLabel, c, re, roster)).toBe(false);
  });

  it('an unresolved roster matches nothing — it never falls back to the label', () => {
    // The set is empty while the roster fetches are in flight, and stays empty
    // for a name that 403s. Neither may leak the labelled non-member through.
    expect(matchStableCriteria(memberNoLabel, c, null, NO_MEMBERS)).toBe(false);
    expect(matchStableCriteria(labelNoMember, c, null, NO_MEMBERS)).toBe(false);
  });

  it('with no incarnation criterion the roster is ignored entirely', () => {
    const covenOnly = { ...EMPTY_HOST_CRITERIA, covens: ['prod'] };
    expect(matchStableCriteria(memberNoLabel, covenOnly, null, NO_MEMBERS)).toBe(true);
  });
});
