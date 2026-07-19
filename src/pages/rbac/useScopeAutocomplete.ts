import { useQuery } from '@tanstack/react-query';
import { keeperApi } from '../../api/keeper';
import type { ScopeDim } from './scopeExpr';

/**
 * Autocomplete values for a scope dimension, sourced from the existing list APIs
 * (NIM-128). coven/service/incarnation/host are backed by real endpoints; every
 * other dimension (trait) has no catalog → free text. Shared by the boolean
 * ScopeBuilder and the resource header chips.
 *
 * `active` gates the network fetch: the caller passes true only once the value
 * field is focused / its dropdown is open, so a screen full of conditions doesn't
 * fire every list endpoint on mount (droplist warm-up was 1-2s). Data stays
 * cached after blur — refocus is instant.
 */
export function useAutocompleteOptions(dim: ScopeDim | '', active = false): string[] {
  const incQ = useQuery({
    queryKey: ['rbac.scope-ac.incarnations'],
    queryFn: () => keeperApi.incarnations.list({ limit: 200 }),
    enabled: dim === 'incarnation' && active,
    staleTime: 60_000,
  });
  const svcQ = useQuery({
    queryKey: ['rbac.scope-ac.services'],
    queryFn: () => keeperApi.services.list(),
    enabled: dim === 'service' && active,
    staleTime: 60_000,
  });
  const soulsQ = useQuery({
    queryKey: ['rbac.scope-ac.souls'],
    queryFn: () => keeperApi.souls.list({ limit: 200 }),
    enabled: dim === 'host' && active,
    staleTime: 60_000,
  });
  // coven — no direct endpoint; collect unique covens from /v1/souls.
  const covenSoulsQ = useQuery({
    queryKey: ['rbac.scope-ac.covens'],
    queryFn: () => keeperApi.souls.list({ limit: 500 }),
    enabled: dim === 'coven' && active,
    staleTime: 60_000,
  });

  if (dim === 'incarnation') {
    return (incQ.data?.items ?? []).map((i) => i.name).filter(Boolean);
  }
  if (dim === 'service') {
    return (svcQ.data?.items ?? []).map((s) => s.name).filter(Boolean);
  }
  if (dim === 'host') {
    return (soulsQ.data?.items ?? []).map((s) => s.sid).filter(Boolean);
  }
  if (dim === 'coven') {
    const all = covenSoulsQ.data?.items ?? [];
    const uniq = new Set<string>();
    for (const s of all) {
      for (const c of s.covens ?? []) uniq.add(c);
    }
    return Array.from(uniq).sort();
  }
  return [];
}
