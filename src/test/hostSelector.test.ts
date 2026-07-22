import { describe, it, expect } from 'vitest';
import { compileSidRegex, matchStableCriteria, EMPTY_HOST_CRITERIA } from '../pages/run/hostSelector';
import type { SoulListEntry } from '../api/keeper';

function soul(sid: string, covens: string[] = []): SoulListEntry {
  return { sid, covens } as SoulListEntry;
}

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
    const matched = souls.filter((s) => matchStableCriteria(s, c, re));
    expect(matched).toHaveLength(0);
  });

  it('`soul-aws-.*` targets only aws', () => {
    const c = { ...EMPTY_HOST_CRITERIA, sidRegex: 'soul-aws-.*' };
    const { re } = compileSidRegex(c.sidRegex);
    const matched = souls.filter((s) => matchStableCriteria(s, c, re));
    expect(matched.map((s) => s.sid)).toEqual(['soul-aws-01', 'soul-aws-02']);
  });

  it('invalid regex (re=null) → regex criterion disabled', () => {
    const c = { ...EMPTY_HOST_CRITERIA, sidRegex: '[' };
    const { re } = compileSidRegex(c.sidRegex);
    expect(re).toBeNull();
    // re=null -> the regex criterion is not applied; but the caller blocks submit on
    // regexError, so "all hosts" never gets sent to the operator.
    const matched = souls.filter((s) => matchStableCriteria(s, c, re));
    expect(matched).toHaveLength(souls.length);
  });
});
