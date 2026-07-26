/**
 * NIM-146: operator-defined console groups.
 *
 * The safety-critical part is the blast radius: whatever tab is open, a command
 * must reach that tab's hosts and nothing else. These are root shells, so a
 * grouping bug that widens the target is the worst failure this page can have.
 */
import { describe, it, expect } from 'vitest';
import type { SoulListEntry } from '../api/keeper';
import {
  ALL_TAB,
  UNGROUPED_TAB,
  buildGroups,
  emptyGroup,
  sidsForTab,
  splitByField,
  splittableFields,
  type GroupDef,
} from '../pages/console/consoleGrouping';

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

const SOULS = [
  soul('mongo-ctl-01', ['mongoshard'], { role: 'control', tier: 'infra' }),
  soul('mongo-ctl-02', ['mongoshard'], { role: 'control', tier: 'infra' }),
  soul('mongo-sh-01', ['mongoshard'], { role: 'data', tier: 'storage' }),
  soul('mongo-sh-02', ['mongoshard'], { role: 'data', tier: 'storage' }),
  soul('mongo-arb-01', ['mongoshard'], { tier: 'infra' }),
];
const ATTACHED = SOULS.map((s) => s.sid);
const CHOIRS = new Map<string, string[]>([
  ['mongo-ctl-01', ['control']],
  ['mongo-ctl-02', ['control']],
  ['mongo-sh-01', ['data']],
  ['mongo-sh-02', ['data']],
]);

const DEFS: GroupDef[] = [
  { id: 'g-control', name: 'control', query: 'trait.role = control' },
  { id: 'g-data', name: 'data', query: 'trait.role = data' },
];

describe('buildGroups', () => {
  it('evaluates each definition over the connected consoles', () => {
    const { groups } = buildGroups(ATTACHED, SOULS, DEFS, CHOIRS, 'no group');
    expect(groups.map((g) => g.id)).toEqual(['g-control', 'g-data', UNGROUPED_TAB]);
    expect(groups[0].sids).toEqual(['mongo-ctl-01', 'mongo-ctl-02']);
    expect(groups[1].sids).toEqual(['mongo-sh-01', 'mongo-sh-02']);
  });

  it('leftovers get their own trailing tab, not just a counter', () => {
    // They are consoles the operator still has to work with, and a counter
    // cannot be typed into.
    const { groups } = buildGroups(ATTACHED, SOULS, DEFS, CHOIRS, 'no group');
    const tail = groups[groups.length - 1];
    expect(tail.id).toBe(UNGROUPED_TAB);
    expect(tail.name).toBe('no group');
    expect(tail.sids).toEqual(['mongo-arb-01']);
  });

  it('no leftovers tab when every console is claimed', () => {
    const covering: GroupDef[] = [{ id: 'g-all', name: 'all', query: 'coven = mongoshard' }];
    const { groups } = buildGroups(ATTACHED, SOULS, covering, CHOIRS, 'no group');
    expect(groups.map((g) => g.id)).toEqual(['g-all']);
  });

  it('no leftovers tab before anything is grouped — All already is that tab', () => {
    const { groups } = buildGroups(ATTACHED, SOULS, [], CHOIRS, 'no group');
    expect(groups).toEqual([]);
  });

  it('reports what no group claimed', () => {
    const { unmatched } = buildGroups(ATTACHED, SOULS, DEFS, CHOIRS, 'no group');
    expect(unmatched).toEqual(['mongo-arb-01']);
  });

  it('badges each pane with the group it belongs to', () => {
    const overlapping: GroupDef[] = [
      ...DEFS,
      { id: 'g-infra', name: 'infra', query: 'trait.tier = infra' },
    ];
    const { labelsBySid } = buildGroups(ATTACHED, SOULS, overlapping, CHOIRS, 'no group');
    // control already claimed mongo-ctl-01, so infra does not also badge it.
    expect(labelsBySid.get('mongo-ctl-01')).toEqual(['control']);
    expect(labelsBySid.get('mongo-arb-01')).toEqual(['infra']);
  });

  it('[INVARIANT] groups are mutually exclusive — first definition wins', () => {
    const overlapping: GroupDef[] = [
      { id: 'g-first', name: 'first', query: 'coven = mongoshard' },
      { id: 'g-second', name: 'second', query: 'trait.role = data' },
    ];
    const { groups } = buildGroups(ATTACHED, SOULS, overlapping, CHOIRS, 'no group');
    expect(groups[0].sids).toEqual(ATTACHED);
    expect(groups[1].sids).toEqual([]);
  });

  it('[INVARIANT] the tab counts partition the wall — nothing is counted twice', () => {
    // Overlapping queries must still sum to the number of attached consoles,
    // otherwise "sent to N" cannot be reasoned about.
    const overlapping: GroupDef[] = [
      { id: 'a', name: 'a', query: 'trait.tier = infra' },
      { id: 'b', name: 'b', query: 'coven = mongoshard' },
    ];
    const { groups } = buildGroups(ATTACHED, SOULS, overlapping, CHOIRS, 'no group');
    const total = groups.reduce((n, g) => n + g.sids.length, 0);
    expect(total).toBe(ATTACHED.length);
    expect(new Set(groups.flatMap((g) => g.sids)).size).toBe(ATTACHED.length);
  });

  it('reordering the definitions changes which group claims a host', () => {
    const reversed: GroupDef[] = [
      { id: 'g-second', name: 'second', query: 'trait.role = data' },
      { id: 'g-first', name: 'first', query: 'coven = mongoshard' },
    ];
    const { groups } = buildGroups(ATTACHED, SOULS, reversed, CHOIRS, 'no group');
    expect(groups[0].sids).toEqual(['mongo-sh-01', 'mongo-sh-02']);
  });

  it('only ever describes what is on the wall', () => {
    const { groups } = buildGroups(['mongo-sh-01'], SOULS, DEFS, CHOIRS, 'no group');
    expect(groups[0].sids).toEqual([]);
    expect(groups[1].sids).toEqual(['mongo-sh-01']);
  });

  it('a group whose hosts left keeps its tab with an honest zero', () => {
    // The operator defined it; silently dropping it would lose their work.
    const { groups } = buildGroups(['mongo-sh-01'], SOULS, DEFS, CHOIRS, 'no group');
    expect(groups.map((g) => g.id)).toEqual(['g-control', 'g-data']);
  });

  it('[INVARIANT] a group with a broken query matches nothing and says why', () => {
    const broken: GroupDef[] = [{ id: 'g-x', name: 'x', query: 'bogus = 1' }];
    const { groups } = buildGroups(ATTACHED, SOULS, broken, CHOIRS, 'no group');
    expect(groups[0].sids).toEqual([]);
    expect(groups[0].error).toMatch(/unknown field/i);
  });

  it('[INVARIANT] an unfinished group matches nothing, not everything', () => {
    const { groups } = buildGroups(ATTACHED, SOULS, [emptyGroup('new')], CHOIRS, 'no group');
    expect(groups[0].sids).toEqual([]);
    expect(groups[0].error).toBeNull();
  });

  it('groups can query by choir, coven or SID pattern too', () => {
    const defs: GroupDef[] = [
      { id: 'a', name: 'by-choir', query: 'choir = data' },
      { id: 'b', name: 'by-sid', query: 'sid ~ mongo-ctl-.*' },
      { id: 'c', name: 'by-coven', query: 'coven = mongoshard' },
    ];
    const { groups } = buildGroups(ATTACHED, SOULS, defs, CHOIRS, 'no group');
    expect(groups[0].sids).toEqual(['mongo-sh-01', 'mongo-sh-02']);
    expect(groups[1].sids).toEqual(['mongo-ctl-01', 'mongo-ctl-02']);
    // Mutually exclusive: the catch-all only gets what the earlier two left.
    expect(groups[2].sids).toEqual(['mongo-arb-01']);
  });
});

describe('sidsForTab', () => {
  const { groups } = buildGroups(ATTACHED, SOULS, DEFS, CHOIRS, 'no group');

  it('the All tab is every attached console', () => {
    expect(sidsForTab(ALL_TAB, groups, ATTACHED)).toEqual(ATTACHED);
  });

  it('[INVARIANT] a group tab reaches that group ONLY', () => {
    expect(sidsForTab('g-control', groups, ATTACHED)).toEqual(['mongo-ctl-01', 'mongo-ctl-02']);
    expect(sidsForTab('g-data', groups, ATTACHED)).toEqual(['mongo-sh-01', 'mongo-sh-02']);
  });

  it('[INVARIANT] the leftovers tab reaches only what no group claimed', () => {
    expect(sidsForTab(UNGROUPED_TAB, groups, ATTACHED)).toEqual(['mongo-arb-01']);
  });

  it('[INVARIANT] an unknown tab reaches nothing — it must NOT fall back to all', () => {
    // Widening on a stale tab would fire a command meant for two control VMs at
    // the whole shard.
    expect(sidsForTab('deleted', groups, ATTACHED)).toEqual([]);
  });
});

describe('auto-split', () => {
  it('offers only axes that actually divide the set', () => {
    const fields = splittableFields(SOULS, CHOIRS);
    expect(fields).toContain('choir');
    expect(fields).toContain('trait.role');
    expect(fields).toContain('trait.tier');
    // Every soul shares one coven, status and transport.
    expect(fields).not.toContain('coven');
    expect(fields).not.toContain('status');
  });

  it('seeds ordinary editable groups, one per value', () => {
    const defs = splitByField(SOULS, 'trait.role', CHOIRS);
    expect(defs.map((d) => d.name)).toEqual(['control', 'data']);
    expect(defs[0].query).toBe('trait.role = control');

    // And the seeded queries evaluate back to the same split.
    const { groups } = buildGroups(ATTACHED, SOULS, defs, CHOIRS, 'no group');
    expect(groups[0].sids).toEqual(['mongo-ctl-01', 'mongo-ctl-02']);
    expect(groups[1].sids).toEqual(['mongo-sh-01', 'mongo-sh-02']);
  });

  it('seeded groups get distinct ids', () => {
    const defs = splitByField(SOULS, 'trait.tier', CHOIRS);
    expect(new Set(defs.map((d) => d.id)).size).toBe(defs.length);
  });
});
