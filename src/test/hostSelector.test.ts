import { describe, it, expect } from 'vitest';
import {
  EMPTY_HOST_CRITERIA,
  activeExclusions,
  applyExclusions,
  compileSidRegex,
  deniedHostFromDetail,
  matchStableCriteria,
  previewTargetKeyForSids,
  sidsFromPreviewKey,
  visibleHostRows,
} from '../pages/run/hostSelector';
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

// NIM-449. Membership is `incarnation_membership`, not the coven column — and the
// brief period when a member inherited the incarnation's name as a label is exactly
// what made the two look interchangeable. NIM-281 ended it. Every fixture here has
// them disagree, so a resolver that went back to reading `souls.coven` fails on the
// SIDs, not just the count.
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

/**
 * NIM-450: the resolved list comes from `soul.list`, the run is authorized under
 * `errand.run`. When the latter is narrower the backend refuses the WHOLE run over one
 * host it does not cover, so the target has to be reducible and the refusal has to point
 * at a host the operator can actually find in their own list.
 */
describe('exclusions — the resolved set minus what the operator dropped', () => {
  const resolved = ['db-1.example.com', 'db-2.example.com', 'db-10.example.com'];

  it('no exclusions → the resolution is the target, same array identity', () => {
    expect(applyExclusions(resolved, EMPTY_HOST_CRITERIA)).toBe(resolved);
    expect(activeExclusions(resolved, EMPTY_HOST_CRITERIA)).toEqual([]);
  });

  it('drops the named host and reports it as active', () => {
    const c = { ...EMPTY_HOST_CRITERIA, excluded: ['db-2.example.com'] };
    expect(applyExclusions(resolved, c)).toEqual(['db-1.example.com', 'db-10.example.com']);
    expect(activeExclusions(resolved, c)).toEqual(['db-2.example.com']);
  });

  it('an exclusion the criteria no longer resolve to is inert', () => {
    // Re-scoping to another coven must not carry a stale removal into the new target:
    // otherwise a host the operator never touched here goes missing from the run.
    const c = { ...EMPTY_HOST_CRITERIA, excluded: ['web-9.example.com'] };
    expect(applyExclusions(resolved, c)).toEqual(resolved);
    expect(activeExclusions(resolved, c)).toEqual([]);
  });
});

describe('deniedHostFromDetail — which host the refusal named', () => {
  // One SID is a suffix of the other, which FQDNs routinely are (`redis.example.com`
  // inside `my-redis.example.com`). Scanning in list order would then blame the shorter
  // host for its neighbour: the operator drops a host they were allowed to run on and
  // the run stays refused for exactly the same reason.
  const target = ['redis.example.com', 'my-redis.example.com'];

  it('finds the host the backend named', () => {
    expect(
      deniedHostFromDetail('operator lacks errand.run on target host redis.example.com', target),
    ).toBe('redis.example.com');
  });

  it('prefers the longest match, so a SID contained in another is not blamed for it', () => {
    expect(
      deniedHostFromDetail('operator lacks errand.run on target host my-redis.example.com', target),
    ).toBe('my-redis.example.com');
  });

  it('a reworded message that names no target host yields null, not a guess', () => {
    expect(deniedHostFromDetail('operator lacks required permission errand.run', target)).toBeNull();
    expect(deniedHostFromDetail('', target)).toBeNull();
  });
});

describe('visibleHostRows — the cap must never hide a removal', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ sid: `db-${i}.example.com` }));

  it('without removals it is just the head of the resolution', () => {
    expect(visibleHostRows(rows, EMPTY_HOST_CRITERIA, 50)).toHaveLength(50);
    expect(visibleHostRows(rows, EMPTY_HOST_CRITERIA, 50).at(-1)!.sid).toBe('db-49.example.com');
  });

  it('a host dropped past the cap is pulled up so its checkbox exists', () => {
    // Without this the operator drops host 55 from the step-4 banner and then cannot
    // put it back: the row it lives on is never rendered.
    const c = { ...EMPTY_HOST_CRITERIA, excluded: ['db-55.example.com'] };
    const shown = visibleHostRows(rows, c, 50).map((r) => r.sid);
    expect(shown).toHaveLength(51);
    expect(shown).toContain('db-55.example.com');
  });

  it('a dropped host already inside the cap is not duplicated', () => {
    const c = { ...EMPTY_HOST_CRITERIA, excluded: ['db-3.example.com'] };
    const shown = visibleHostRows(rows, c, 50).map((r) => r.sid);
    expect(shown).toHaveLength(50);
    expect(shown.filter((s) => s === 'db-3.example.com')).toHaveLength(1);
  });

  it('the hidden count stays truthful when rows are pulled up', () => {
    // The UI renders "and N more" as total - rendered; a rescued row must move that number.
    const c = { ...EMPTY_HOST_CRITERIA, excluded: ['db-55.example.com', 'db-56.example.com'] };
    const shown = visibleHostRows(rows, c, 50);
    expect(rows.length - shown.length).toBe(8);
  });
});

describe('preview key — producer and parser stay symmetric', () => {
  it('round-trips the asked-about SIDs', () => {
    const key = previewTargetKeyForSids(['db-1.example.com', 'db-2.example.com'], 'core.cmd.shell');
    expect(sidsFromPreviewKey(key)).toEqual(['db-1.example.com', 'db-2.example.com']);
  });

  it('the module is part of the key, so a verdict does not outlive a module switch', () => {
    const a = previewTargetKeyForSids(['db-1.example.com'], 'core.cmd.shell');
    const b = previewTargetKeyForSids(['db-1.example.com'], 'core.pkg.installed');
    expect(a).not.toBe(b);
  });

  it('a key that is not a SID target yields no hosts rather than throwing', () => {
    // The late-binding key carries covens, and there is no key at all before step 4.
    expect(sidsFromPreviewKey(null)).toEqual([]);
    expect(sidsFromPreviewKey(JSON.stringify({ covens: ['prod'] }))).toEqual([]);
    expect(sidsFromPreviewKey('not json')).toEqual([]);
  });
});
