// Resolves console scope criteria into concrete SIDs.
//
// Same three-stage shape as the Run Wizard's Command workload
// (src/pages/run/RunWizard.tsx): cheap stable criteria first, then a per-SID
// soulprint fetch only for the survivors and only when a soulprint rule is set.
// Kept as its own hook rather than lifted out of the wizard so the wizard's
// behaviour — and the tests pinned to it — stay untouched.

import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { keeperApi, type SoulListEntry } from '../../api/keeper';
import {
  SOULPRINT_FANOUT_LIMIT,
  compileSidRegex,
  hasAnyCriteria,
  matchSoulprint,
  matchStableCriteria,
  needsSoulprint,
  parseCriteriaSoulprint,
  type HostCriteria,
} from '../run/hostSelector';
import { useIncarnationMembers, type UnresolvedIncarnation } from '../run/useIncarnationMembers';

export interface HostResolution {
  // All known souls — also feeds grouping and the scope preview.
  allSouls: SoulListEntry[];
  // Souls matching the criteria.
  matched: SoulListEntry[];
  sids: string[];
  loading: boolean;
  soulsUnavailable: boolean;
  // The registry outgrew the read cap: `allSouls` is a prefix of it, so the scope
  // preview is a lower bound rather than the answer.
  soulsTruncated: boolean;
  // Rows read, and rows the registry holds — the two numbers the warning quotes.
  soulsScanned: number;
  soulsTotal: number;
  // The soulprint criterion has more candidates than it will read one by one, so
  // it was not evaluated at all and `matched` is empty on purpose.
  soulprintOverload: boolean;
  soulprintCandidates: number;
  // Soulprint tokens the DSL did not recognize (inline warning).
  invalidSoulprint: string[];
  regexError: string | null;
  hasCriteria: boolean;
  // Incarnations whose roster did not arrive — their hosts are NOT in `matched`,
  // and the scope step says so rather than silently opening a narrower session.
  unresolvedIncarnations: UnresolvedIncarnation[];
}

export function useHostResolution(criteria: HostCriteria): HostResolution {
  // Every page of the registry, not the first one: the criteria are matched against
  // this list and the survivors become the hosts the wall connects to, so a host
  // past the first page would be missing from the shells with nothing on screen to
  // say so — the same silent drop the wizard had (NIM-448).
  const soulsQ = useQuery({
    queryKey: ['console.souls.list'],
    queryFn: () => keeperApi.souls.listAll(),
    staleTime: 30_000,
    retry: false,
  });
  const allSouls = useMemo<SoulListEntry[]>(() => soulsQ.data?.items ?? [], [soulsQ.data]);

  const parsedSoulprint = useMemo(() => parseCriteriaSoulprint(criteria), [criteria]);
  const sidRegexComp = useMemo(() => compileSidRegex(criteria.sidRegex), [criteria.sidRegex]);
  const hasCriteria = hasAnyCriteria(criteria);
  const membership = useIncarnationMembers(criteria.incarnations);

  const stableMatched = useMemo<SoulListEntry[]>(() => {
    if (!hasCriteria) return [];
    return allSouls.filter((s) => matchStableCriteria(s, criteria, sidRegexComp.re, membership.memberSids));
  }, [hasCriteria, allSouls, criteria, sidRegexComp.re, membership.memberSids]);

  // NO criterion, NO array — react-query builds an observer per descriptor whether
  // or not it is enabled, and the candidate set is no longer bounded by one page.
  // Past SOULPRINT_FANOUT_LIMIT the stage is refused rather than run over part of
  // the candidates: connecting to a slice of the scope is the failure this fixes.
  const soulprintActive = needsSoulprint(criteria);
  const soulprintOverload = soulprintActive && stableMatched.length > SOULPRINT_FANOUT_LIMIT;
  const soulprintEnabled = soulprintActive && !soulprintOverload;
  const soulprintQueries = useQueries({
    queries: soulprintEnabled
      ? stableMatched.map((row) => ({
          queryKey: ['soulprint', row.sid] as const,
          queryFn: async () => {
            try {
              return await keeperApi.souls.getSoulprint(row.sid);
            } catch {
              return null;
            }
          },
          staleTime: 60_000,
        }))
      : [],
  });
  const soulprintLoading = soulprintEnabled && soulprintQueries.some((r) => r.isLoading);

  const matched = useMemo<SoulListEntry[]>(() => {
    if (soulprintOverload) return [];
    if (!soulprintActive) return stableMatched;
    const out: SoulListEntry[] = [];
    for (let i = 0; i < stableMatched.length; i += 1) {
      if (matchSoulprint(soulprintQueries[i]?.data?.typed_facts, parsedSoulprint.rules)) {
        out.push(stableMatched[i]);
      }
    }
    return out;
    // soulprintQueries is a fresh array each render; the data it carries is
    // keyed by stableMatched, which is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soulprintActive, soulprintOverload, stableMatched, parsedSoulprint.rules, soulprintLoading]);

  return {
    allSouls,
    matched,
    sids: useMemo(() => matched.map((s) => s.sid), [matched]),
    loading: soulsQ.isLoading || soulprintLoading || membership.loading,
    soulsUnavailable: soulsQ.isError,
    soulsTruncated: soulsQ.data?.truncated ?? false,
    soulsScanned: allSouls.length,
    soulsTotal: soulsQ.data?.total ?? 0,
    soulprintOverload,
    soulprintCandidates: stableMatched.length,
    invalidSoulprint: parsedSoulprint.invalid,
    regexError: sidRegexComp.error,
    hasCriteria,
    unresolvedIncarnations: membership.unresolved,
  };
}
