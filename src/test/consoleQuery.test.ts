/**
 * NIM-146: the group query language.
 *
 * Two things matter most. First, text and builder must round-trip exactly —
 * the builder edits the same string the operator types, so a lossy conversion
 * would silently rewrite their group. Second, a query must never match MORE
 * than it says: these groups decide where a root-shell command lands.
 */
import { describe, it, expect } from 'vitest';
import type { SoulListEntry } from '../api/keeper';
import {
  EMPTY_QUERY,
  availableFields,
  evalQuery,
  fieldSuggestions,
  fieldValues,
  formatQuery,
  parseQuery,
} from '../pages/console/consoleQuery';

function soul(sid: string, covens: string[], traits: Record<string, unknown> = {}): SoulListEntry {
  return {
    sid,
    covens,
    traits,
    status: 'connected',
    transport: 'agent',
    registered_at: '2026-01-01T00:00:00Z',
    requested_at: null,
    last_seen_at: null,
    last_seen_by_kid: null,
    created_by_aid: null,
  } as SoulListEntry;
}

const CHOIRS = new Map<string, string[]>([['mongo-ctl-01', ['control']]]);
const CTL = soul('mongo-ctl-01', ['mongoshard', 'infra'], { role: 'control', tier: 'infra' });
const SH = soul('mongo-sh-01', ['mongoshard'], { role: 'data' });
const ARB = soul('mongo-arb-01', ['mongoshard'], {});

function ok(text: string) {
  const { query, error } = parseQuery(text);
  expect(error).toBeNull();
  return query!;
}

describe('parseQuery', () => {
  it('parses a single condition', () => {
    expect(ok('coven = payments')).toEqual({
      join: 'and',
      conditions: [{ field: 'coven', op: '=', value: 'payments' }],
    });
  });

  it('parses without spaces around the operator', () => {
    expect(ok('coven=payments').conditions[0]).toEqual({ field: 'coven', op: '=', value: 'payments' });
  });

  it('parses every operator, preferring the two-character ones', () => {
    expect(ok('sid != a').conditions[0].op).toBe('!=');
    expect(ok('sid !~ a.*').conditions[0].op).toBe('!~');
    expect(ok('sid ~ a.*').conditions[0].op).toBe('~');
  });

  it('parses and/or joins, case-insensitively', () => {
    expect(ok('coven = a and sid ~ b.*').join).toBe('and');
    expect(ok('coven = a OR coven = b').join).toBe('or');
    expect(ok('coven = a or coven = b').conditions).toHaveLength(2);
  });

  it('parses trait keys', () => {
    expect(ok('trait.tier = infra').conditions[0].field).toBe('trait.tier');
  });

  it('keeps quoted values intact, separators and all', () => {
    expect(ok('sid = "web and db"').conditions[0].value).toBe('web and db');
  });

  it('an empty query is empty, not an error', () => {
    expect(parseQuery('   ')).toEqual({ query: EMPTY_QUERY, error: null });
  });

  it('[INVARIANT] an unfinished condition parses but matches nothing', () => {
    // The builder rewrites this string on every keystroke; rejecting a cleared
    // value would tear the builder down mid-edit. It must also never match:
    // a group being typed must not sweep up hosts on the way.
    const { query, error } = parseQuery('trait.role =');
    expect(error).toBeNull();
    expect(query!.conditions[0]).toEqual({ field: 'trait.role', op: '=', value: '' });
    expect(evalQuery(CTL, query!, CHOIRS)).toBe(false);
    expect(evalQuery(ARB, query!, CHOIRS)).toBe(false);
  });

  it('an unfinished condition survives a format round-trip un-quoted', () => {
    const text = formatQuery({ join: 'and', conditions: [{ field: 'sid', op: '=', value: '' }] });
    expect(text).toBe('sid = ');
    expect(parseQuery(text).error).toBeNull();
  });

  it('rejects what it cannot represent, with a usable message', () => {
    expect(parseQuery('(a = b)').error).toMatch(/parenthes/i);
    expect(parseQuery('coven = a and sid = b or sid = c').error).toMatch(/mixing/i);
    expect(parseQuery('nonsense').error).toMatch(/not a condition/i);
    expect(parseQuery('bogus = x').error).toMatch(/unknown field/i);
    expect(parseQuery('sid ~ [').error).toMatch(/regular expression/i);
  });
});

describe('formatQuery round-trip', () => {
  it('[INVARIANT] text -> parse -> format is stable', () => {
    for (const text of [
      'coven = payments',
      'sid ~ mongo-.* and trait.tier = infra',
      'choir = control or choir = data',
      'status != connected',
      'trait.role !~ data.*',
    ]) {
      expect(formatQuery(ok(text))).toBe(text);
    }
  });

  it('re-quotes values that would otherwise re-parse differently', () => {
    const text = formatQuery({ join: 'and', conditions: [{ field: 'sid', op: '=', value: 'a and b' }] });
    expect(text).toBe('sid = "a and b"');
    expect(ok(text).conditions[0].value).toBe('a and b');
  });
});

describe('fieldValues', () => {
  it('reads each axis', () => {
    expect(fieldValues(CTL, 'sid', CHOIRS)).toEqual(['mongo-ctl-01']);
    expect(fieldValues(CTL, 'coven', CHOIRS)).toEqual(['mongoshard', 'infra']);
    expect(fieldValues(CTL, 'choir', CHOIRS)).toEqual(['control']);
    expect(fieldValues(CTL, 'trait.tier', CHOIRS)).toEqual(['infra']);
    expect(fieldValues(CTL, 'status', CHOIRS)).toEqual(['connected']);
  });

  it('a list-valued trait yields each value', () => {
    expect(fieldValues(soul('x', [], { t: ['a', 'b'] }), 'trait.t', CHOIRS)).toEqual(['a', 'b']);
  });

  it('a missing value is no value', () => {
    expect(fieldValues(ARB, 'trait.role', CHOIRS)).toEqual([]);
  });
});

describe('evalQuery', () => {
  it('[INVARIANT] an empty query matches NOTHING', () => {
    // A half-written group must not silently swallow the whole wall.
    expect(evalQuery(CTL, EMPTY_QUERY, CHOIRS)).toBe(false);
  });

  it('= is exact, over any of a multi-valued field', () => {
    expect(evalQuery(CTL, ok('coven = infra'), CHOIRS)).toBe(true);
    expect(evalQuery(CTL, ok('coven = inf'), CHOIRS)).toBe(false);
  });

  it('[INVARIANT] ~ is anchored — a partial name does not match', () => {
    // Unanchored, `mongo` would match every host and over-group the wall.
    expect(evalQuery(CTL, ok('sid ~ mongo'), CHOIRS)).toBe(false);
    expect(evalQuery(CTL, ok('sid ~ mongo-ctl-.*'), CHOIRS)).toBe(true);
  });

  it('!= and !~ are true when the host has no such value at all', () => {
    expect(evalQuery(ARB, ok('trait.role != data'), CHOIRS)).toBe(true);
    expect(evalQuery(ARB, ok('trait.role !~ .*'), CHOIRS)).toBe(true);
  });

  it('and requires every condition; or requires one', () => {
    expect(evalQuery(CTL, ok('coven = mongoshard and trait.role = control'), CHOIRS)).toBe(true);
    expect(evalQuery(CTL, ok('coven = mongoshard and trait.role = data'), CHOIRS)).toBe(false);
    expect(evalQuery(SH, ok('trait.role = control or trait.role = data'), CHOIRS)).toBe(true);
  });

  it('a host outside the choir map does not match a choir condition', () => {
    expect(evalQuery(SH, ok('choir = control'), CHOIRS)).toBe(false);
  });
});

describe('builder helpers', () => {
  it('offers the fixed axes plus the trait keys actually present', () => {
    const fields = availableFields([CTL, SH], CHOIRS);
    expect(fields).toContain('sid');
    expect(fields).toContain('coven');
    expect(fields).toContain('choir');
    expect(fields).toContain('trait.role');
    expect(fields).toContain('trait.tier');
  });

  it('omits choir when no topology is loaded', () => {
    expect(availableFields([CTL, SH], new Map())).not.toContain('choir');
  });

  it('suggests the distinct values present', () => {
    expect(fieldSuggestions([CTL, SH, ARB], 'trait.role', CHOIRS)).toEqual(['control', 'data']);
    expect(fieldSuggestions([CTL, SH], 'coven', CHOIRS)).toEqual(['infra', 'mongoshard']);
  });
});
