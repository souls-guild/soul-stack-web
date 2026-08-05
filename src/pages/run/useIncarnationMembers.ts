// Resolves the "Incarnations" host criterion into the SIDs those incarnations
// actually hold.
//
// Membership is the `incarnation_membership` relation (NIM-124), NOT the
// `souls.coven` column — even though an incarnation's name is also a label its
// members inherit. Reading the criterion off that column, as this resolver did
// until NIM-449, is wrong in both directions: a member that never got the label
// is dropped, and a host tagged with the name without being bound is targeted.
// The backend does not make that mistake — it resolves a coven over the
// EFFECTIVE label union, which membership feeds — but the wizard and the console
// resolve client-side and send an explicit SID list, so their answer is the
// final one and nothing downstream corrects it.
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
