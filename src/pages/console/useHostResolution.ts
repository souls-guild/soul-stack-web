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
  compileSidRegex,
  hasAnyCriteria,
  matchSoulprint,
  matchStableCriteria,
  needsSoulprint,
  parseCriteriaSoulprint,
  type HostCriteria,
} from '../run/hostSelector';

export interface HostResolution {
  // All known souls — also feeds grouping and the scope preview.
  allSouls: SoulListEntry[];
  // Souls matching the criteria.
  matched: SoulListEntry[];
  sids: string[];
  loading: boolean;
  soulsUnavailable: boolean;
  // Soulprint tokens the DSL did not recognize (inline warning).
  invalidSoulprint: string[];
  regexError: string | null;
  hasCriteria: boolean;
}

export function useHostResolution(criteria: HostCriteria): HostResolution {
  const soulsQ = useQuery({
    queryKey: ['console.souls.list'],
    queryFn: () => keeperApi.souls.list({ limit: 1000 }),
    staleTime: 30_000,
    retry: false,
  });
  const allSouls = useMemo<SoulListEntry[]>(() => soulsQ.data?.items ?? [], [soulsQ.data]);

  const parsedSoulprint = useMemo(() => parseCriteriaSoulprint(criteria), [criteria]);
  const sidRegexComp = useMemo(() => compileSidRegex(criteria.sidRegex), [criteria.sidRegex]);
  const hasCriteria = hasAnyCriteria(criteria);

  const stableMatched = useMemo<SoulListEntry[]>(() => {
    if (!hasCriteria) return [];
    return allSouls.filter((s) => matchStableCriteria(s, criteria, sidRegexComp.re));
  }, [hasCriteria, allSouls, criteria, sidRegexComp.re]);

  const soulprintActive = needsSoulprint(criteria);
  const soulprintQueries = useQueries({
    queries: stableMatched.map((row) => ({
      queryKey: ['soulprint', row.sid] as const,
      queryFn: async () => {
        try {
          return await keeperApi.souls.getSoulprint(row.sid);
        } catch {
          return null;
        }
      },
      enabled: soulprintActive,
      staleTime: 60_000,
    })),
  });
  const soulprintLoading = soulprintActive && soulprintQueries.some((r) => r.isLoading);

  const matched = useMemo<SoulListEntry[]>(() => {
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
  }, [soulprintActive, stableMatched, parsedSoulprint.rules, soulprintLoading]);

  return {
    allSouls,
    matched,
    sids: useMemo(() => matched.map((s) => s.sid), [matched]),
    loading: soulsQ.isLoading || soulprintLoading,
    soulsUnavailable: soulsQ.isError,
    invalidSoulprint: parsedSoulprint.invalid,
    regexError: sidRegexComp.error,
    hasCriteria,
  };
}
