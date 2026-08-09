// Resolves the "Incarnations" host criterion into the SIDs those incarnations
// actually hold.
//
// Membership is the `incarnation_membership` relation (NIM-124), NOT the
// `souls.coven` column. The two were briefly interchangeable: under ADR-080 a
// host inherited the labels — and the NAME — of every incarnation it belonged
// to, which is exactly what made reading the criterion off that column look
// right. NIM-281 reverted that inheritance in full, in every reader: a label
// exists only where an operator attached it, and belonging attaches nothing. So
// the column now answers a strictly different question, and the criterion read
// off it is wrong in both directions — a member nobody tagged is dropped, and a
// host tagged with the name without being bound is targeted.
//
// The backend draws the same line (`?coven=` is a label question over
// `souls.coven` alone; membership is answered from the relation), but the wizard
// and the console resolve client-side and send an explicit SID list, so their
// answer is the final one and nothing downstream corrects it.
//
// One request per name; the results are OR'ed, because the criterion means "in
// ANY of these incarnations". A name whose roster does not arrive contributes
// nothing and is reported in `unresolved`: it never widens the set, and it never
// cancels out the names that did resolve.

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { keeperApi } from '../../api/keeper';

// Why a name contributed no hosts: `unknown` — no such incarnation (404);
// `forbidden` — its roster is not readable with these permissions (403);
// `failed` — anything else, the network included.
export type MembershipFailure = 'unknown' | 'forbidden' | 'failed';

export interface UnresolvedIncarnation {
  name: string;
  reason: MembershipFailure;
}

export interface IncarnationMembership {
  // Union of the rosters. Empty while the fetches are in flight, so a caller
  // that reports "nothing matches" without reading `loading` first would lie —
  // and empty for a name in `unresolved`, which is why that list is surfaced
  // rather than folded into a count.
  memberSids: ReadonlySet<string>;
  loading: boolean;
  unresolved: UnresolvedIncarnation[];
}

const EMPTY_SIDS: ReadonlySet<string> = new Set<string>();

function failureOf(error: unknown): MembershipFailure {
  if (error instanceof ApiError) {
    if (error.status === 404) return 'unknown';
    if (error.status === 403) return 'forbidden';
  }
  return 'failed';
}

export function useIncarnationMembers(names: string[]): IncarnationMembership {
  const results = useQueries({
    queries: names.map((name) => ({
      // The cache entry MembersPanel reads the roster under, so the two share
      // one fetch and cannot show two different rosters for the same name.
      queryKey: ['incarnation-members', name] as const,
      queryFn: () => keeperApi.incarnations.members(name),
      staleTime: 30_000,
      retry: false,
    })),
  });

  const loading = results.some((r) => r.isLoading);

  // useQueries hands back a fresh array every render; what actually changes is
  // the per-name status and the SIDs it carries, so the memo is keyed on those.
  // Fields are separated because concatenation alone is ambiguous: without the
  // separators one name's SID list and the next name would run together.
  const dataKey = results
    .map((r, i) => `${names[i]}|${r.status}|${(r.data?.items ?? []).map((m) => m.sid).join(',')}`)
    .join(';');

  const memberSids = useMemo<ReadonlySet<string>>(() => {
    if (names.length === 0) return EMPTY_SIDS;
    const out = new Set<string>();
    for (const r of results) {
      // Every roster row, whatever `m.status` says: that column is the stale
      // `souls.status` snapshot, and presence is not this resolver's question.
      for (const m of r.data?.items ?? []) out.add(m.sid);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  const unresolved = useMemo<UnresolvedIncarnation[]>(() => {
    const out: UnresolvedIncarnation[] = [];
    for (let i = 0; i < results.length; i += 1) {
      if (results[i].isError) out.push({ name: names[i], reason: failureOf(results[i].error) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  return { memberSids, loading, unresolved };
}

// How many names this resolver will read rosters for. One request per name, and
// the scenario picker lists every incarnation of a service, so the fan-out is
// bounded rather than left to grow with the fleet. Past the cap NOTHING is read
// and every size is unknown — a partial tally would read as a complete one.
export const ROSTER_SIZE_FANOUT_LIMIT = 100;

export interface RosterSizes {
  // Roster size per name. A name is ABSENT when its size was not read — the
  // request failed, is still in flight, or the list was past the cap. Absent is
  // NOT zero: a caller that defaults it puts a number on screen that is quietly
  // short of what the run will reach.
  sizeByName: ReadonlyMap<string, number>;
  loading: boolean;
  // The list outgrew the cap, so no size was read at all.
  overCap: boolean;
  // Why a name has no size, when the reason is an answer rather than a wait.
  // Three causes, three different next steps — and without them a blank count
  // is indistinguishable from a count still on its way.
  unresolved: UnresolvedIncarnation[];
}

const EMPTY_SIZES: ReadonlyMap<string, number> = new Map<string, number>();

// Roster size of each named incarnation, counted over `incarnation_membership`.
//
// The size comes from the reply's `total` — the field that names the count. The
// endpoint is unpaginated today and the server derives `total` and `items` from
// one slice, so it agrees with `items.length`; it is the field that keeps agreeing
// if paging is ever added.
//
// THIS IS THE ROSTER, NOT THE RUN'S REACH, and the two miss each other in both
// directions:
//   - the reply is narrowed to the hosts inside the CALLER's soul scope
//     (`("soul","list")`), while a scenario run resolves its own hosts through
//     `topology.LoadIncarnationHosts`, which takes no claims at all and is
//     therefore narrowed by nobody. A narrow scope shows FEWER hosts than the
//     run touches;
//   - the reply carries every member whatever its status, while the run keeps
//     only members that are non-terminal AND hold a live presence lease. Hosts
//     that are merely offline are counted here and skipped there.
// Callers must not present this number as what the run will do.
//
// Same query key as [useIncarnationMembers] and MembersPanel, so a name read
// here and resolved there cannot come back as two different rosters.
export function useIncarnationRosterSizes(names: string[], enabled: boolean): RosterSizes {
  const overCap = names.length > ROSTER_SIZE_FANOUT_LIMIT;
  const active = enabled && names.length > 0 && !overCap;

  const results = useQueries({
    queries: active
      ? names.map((name) => ({
          queryKey: ['incarnation-members', name] as const,
          queryFn: () => keeperApi.incarnations.members(name),
          staleTime: 30_000,
          retry: false,
        }))
      : [],
  });

  const loading = results.some((r) => r.isLoading);

  // Same reasoning as the memo above: useQueries returns a fresh array each
  // render, and what actually changes is the per-name status and the count.
  const dataKey = results.map((r, i) => `${names[i]}|${r.status}|${r.data?.total ?? ''}`).join(';');

  const sizeByName = useMemo<ReadonlyMap<string, number>>(() => {
    if (!active) return EMPTY_SIZES;
    const out = new Map<string, number>();
    for (let i = 0; i < results.length; i += 1) {
      const total = results[i].data?.total;
      if (typeof total === 'number') out.set(names[i], total);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, active]);

  const unresolved = useMemo<UnresolvedIncarnation[]>(() => {
    if (!active) return [];
    const out: UnresolvedIncarnation[] = [];
    for (let i = 0; i < results.length; i += 1) {
      if (results[i].isError) out.push({ name: names[i], reason: failureOf(results[i].error) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, active]);

  return { sizeByName, loading, overCap, unresolved };
}

// How many hosts the whole fan-out reaches — or `undefined` when that cannot be
// said yet.
//
// UNKNOWN STAYS UNKNOWN. One name whose roster did not arrive makes the sum
// unknowable, and treating it as zero would badge a total quietly short of what
// the run will touch — the one number the operator reads before pressing Run, and
// the kind of shortfall nothing later on the screen contradicts. A missing badge
// asks a question; a wrong badge answers one.
export function totalRosterSize(
  names: readonly string[],
  counts: Record<string, number> | undefined,
): number | undefined {
  if (!counts) return undefined;
  let total = 0;
  for (const name of names) {
    const size = counts[name];
    if (size === undefined) return undefined;
    total += size;
  }
  return total;
}
