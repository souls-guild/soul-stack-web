import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { keeperApi } from '../../api/keeper';
import { isFreezeRefusal, windowsKey } from './maintenance';

/**
 * Freeze consent for an act on one incarnation that is never deferred — destroy,
 * rerun-last, the upgrade's scenario (NIM-1074, NIM-1085). The active freeze comes
 * from the server's status block; a 409 the read did not foresee opens the same
 * consent. `blocked` keeps the act's button disabled until consent is ticked.
 *
 * `asked` is false for an act Keeper does not gate (an upgrade with no scenario):
 * then only a 409 opens the block. Consent is given for the freeze on screen, so a
 * different freeze arriving on a refetch asks again.
 */
export function useFreezeConsent(incarnation: string, enabled: boolean, asked = true) {
  const status = useQuery({
    queryKey: windowsKey(incarnation),
    queryFn: () => keeperApi.maintenance.listWindows(incarnation),
    enabled: enabled && Boolean(incarnation),
    retry: false,
    staleTime: 15_000,
  });
  const [refusal, setRefusal] = useState<string | null>(null);
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const freeze = asked ? status.data?.status?.active_freeze : undefined;
  const needed = Boolean(freeze) || refusal !== null;
  const key = `${freeze?.id ?? ''}|${refusal ?? ''}`;
  const consent = needed && consentFor === key;
  return {
    freeze,
    refusal,
    needed,
    consent,
    setConsent: (v: boolean) => setConsentFor(v ? key : null),
    blocked: needed && !consent,
    // What the request carries: consent only where it was asked for.
    confirmFreeze: consent,
    /** Takes a 409 freeze-active into the consent block; false for any other error. */
    takeRefusal(err: unknown): boolean {
      if (!isFreezeRefusal(err)) return false;
      setRefusal(err.detail);
      setConsentFor(null);
      return true;
    },
    reset() {
      setRefusal(null);
      setConsentFor(null);
    },
  };
}
