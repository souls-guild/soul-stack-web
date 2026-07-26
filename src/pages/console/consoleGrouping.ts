// Operator-defined console groups.
//
// A group is a name plus a query (consoleQuery.ts). The operator authors them —
// by typing a query or clicking one together in the builder — instead of
// choosing from axes we guessed at. Grouping is purely an operator convenience:
// it changes which consoles you look at and which ones a command reaches, and
// nothing about it touches the wire.

import type { SoulListEntry } from '../../api/keeper';
import { evalQuery, fieldValues, formatQuery, parseQuery, type ParsedQuery } from './consoleQuery';

export interface GroupDef {
  // Stable across edits — the active tab and its command draft are keyed by it,
  // so renaming a group must not move the operator to a different one.
  id: string;
  name: string;
  // Canonical text form; the builder edits the same string.
  query: string;
}

export interface ConsoleGroup {
  id: string;
  name: string;
  sids: string[];
  // Parse failure for this group's query; it then matches nothing.
  error: string | null;
}

export interface GroupingResult {
  groups: ConsoleGroup[];
  // Per-SID group names for the pane badge.
  labelsBySid: Map<string, string[]>;
  // Attached consoles matched by no group at all.
  unmatched: string[];
}

// Key of the always-present first tab.
export const ALL_TAB = '__all__';

// Trailing tab holding whatever no group claimed. Reserved, and DOM-safe: it
// becomes a data-testid and a React key. Cannot collide with a group id (`g<N>`).
export const UNGROUPED_TAB = '__ungrouped__';

let groupSeq = 0;
export function newGroupId(): string {
  groupSeq += 1;
  return `g${groupSeq}`;
}

// Evaluates the definitions over the CONNECTED consoles. Grouping only ever
// describes what is on the wall, so a group whose hosts went away keeps its tab
// (the operator defined it) but reports an honest count of zero.
//
// Groups are MUTUALLY EXCLUSIVE: every console belongs to at most one, and
// overlapping queries are resolved by definition order — first match wins. That
// keeps the tab counts a partition of the wall (they sum to the total), so
// "sent to N" can be reasoned about without checking whether some host sat in
// two tabs and took the command twice. Reorder the groups to change priority.
export function buildGroups(
  attached: readonly string[],
  souls: readonly SoulListEntry[],
  defs: readonly GroupDef[],
  choirsBySid: ReadonlyMap<string, string[]>,
  ungroupedLabel: string,
): GroupingResult {
  const bySid = new Map(souls.map((s) => [s.sid, s]));
  const labelsBySid = new Map<string, string[]>();
  const matched = new Set<string>();
  const groups: ConsoleGroup[] = [];

  for (const def of defs) {
    const { query, error } = parseQuery(def.query);
    const sids: string[] = [];
    if (query) {
      for (const sid of attached) {
        if (matched.has(sid)) continue; // claimed by an earlier group
        const soul = bySid.get(sid);
        if (!soul || !evalQuery(soul, query, choirsBySid)) continue;
        sids.push(sid);
        matched.add(sid);
        const list = labelsBySid.get(sid);
        if (list) list.push(def.name);
        else labelsBySid.set(sid, [def.name]);
      }
    }
    groups.push({ id: def.id, name: def.name, sids, error });
  }

  const unmatched = attached.filter((sid) => !matched.has(sid));

  // Leftovers get a tab of their own rather than a footnote: they are consoles
  // the operator still has to work with, and a counter cannot be typed into.
  // Only once something is grouped — otherwise All already is that tab.
  if (unmatched.length > 0 && groups.length > 0) {
    groups.push({ id: UNGROUPED_TAB, name: ungroupedLabel, sids: unmatched, error: null });
  }

  return { groups, labelsBySid, unmatched };
}

// SIDs the active tab addresses. An unknown tab reaches NOTHING rather than
// falling back to everything — a stale tab must not widen a command aimed at a
// handful of hosts into a wall-wide one.
export function sidsForTab(
  tab: string,
  groups: readonly ConsoleGroup[],
  attached: readonly string[],
): string[] {
  if (tab === ALL_TAB) return [...attached];
  const group = groups.find((g) => g.id === tab);
  return group ? [...group.sids] : [];
}

// --- auto-split ---
//
// Seeds group definitions from one axis, so the common "split by choir" case is
// one click and the result is still ordinary editable groups.

export const SPLIT_FIELDS = ['coven', 'choir', 'status', 'transport'] as const;

// Axes that actually divide this set — offering one that yields a single group
// is just noise.
export function splittableFields(
  souls: readonly SoulListEntry[],
  choirsBySid: ReadonlyMap<string, string[]>,
): string[] {
  const candidates = [...SPLIT_FIELDS.filter((f) => f !== 'choir' || choirsBySid.size > 0)];
  const traitKeys = new Set<string>();
  for (const s of souls) for (const k of Object.keys(s.traits ?? {})) traitKeys.add(k);
  for (const k of [...traitKeys].sort()) candidates.push(`trait.${k}` as (typeof SPLIT_FIELDS)[number]);

  return candidates.filter((field) => {
    const seen = new Set<string>();
    for (const s of souls) for (const v of fieldValues(s, field, choirsBySid)) seen.add(v);
    return seen.size > 1;
  });
}

export function splitByField(
  souls: readonly SoulListEntry[],
  field: string,
  choirsBySid: ReadonlyMap<string, string[]>,
): GroupDef[] {
  const values = new Set<string>();
  for (const s of souls) for (const v of fieldValues(s, field, choirsBySid)) values.add(v);
  return [...values].sort().map((value) => ({
    id: newGroupId(),
    name: value,
    query: formatQuery({ join: 'and', conditions: [{ field, op: '=', value }] }),
  }));
}

// A fresh, empty group for the editor's "add" action.
export function emptyGroup(name: string): GroupDef {
  return { id: newGroupId(), name, query: '' };
}

export type { ParsedQuery };
