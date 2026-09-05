// Guard tests for one invariant, on every surface that has to hold it:
//
//   BELONGING TO AN INCARNATION ATTACHES NO LABEL, AND A LABEL GRANTS NO BELONGING.
//
// For a short window (ADR-080) it did both: a host read back the covens — and the
// NAME — of every incarnation it belonged to, so `souls.coven` and
// `incarnation_membership` answered the same question and the UI could read either.
// NIM-281 reverted that in every reader. The column and the relation are now
// different sets, and each surface that reads the wrong one is wrong in BOTH
// directions at once: it drops a member nobody tagged, and it picks up a host whose
// operator happened to tag it with a string that spells the incarnation's name.
//
// Every fixture below is built so the two sets DISAGREE — `member.local` is bound
// and unlabelled, `stranger.local` is labelled and unbound. A surface that swapped
// back to the other source therefore fails on the SIDs, not merely on a count.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '../hooks/useTheme';
import { IncarnationDetail } from '../pages/incarnations/IncarnationDetail';
import {
  useIncarnationRosterSizes,
  totalRosterSize,
  ROSTER_SIZE_FANOUT_LIMIT,
} from '../pages/run/useIncarnationMembers';
import { matchStableCriteria, EMPTY_HOST_CRITERIA } from '../pages/run/hostSelector';
import type { SoulListEntry } from '../api/keeper';
import { tokenStore } from '../api/tokenStore';

const INCARNATION_NAME = 'redis-prod';

// Bound to redis-prod. Carries only the tag its operator attached, which is not
// the incarnation's name — the bind attached nothing.
const MEMBER: SoulListEntry = {
  sid: 'member.local',
  status: 'connected',
  transport: 'agent',
  covens: ['prod'],
  traits: {},
} as SoulListEntry;

// Never bound to anything. Somebody tagged it `redis-prod` — a label is just a
// string, and nothing stops an operator from choosing that one.
const STRANGER: SoulListEntry = {
  sid: 'stranger.local',
  status: 'connected',
  transport: 'agent',
  covens: [INCARNATION_NAME],
  traits: {},
} as SoulListEntry;

// Shaped the way the server actually replies: the endpoint takes no limit/offset
// and derives `limit`/`total` from the slice it returns, so `total === items.length`
// always. A fixture with `total` larger than `items.length` would be a state keeper
// cannot produce, and a guard standing on one gates nothing.
//
// The discriminating power is elsewhere, and it is stronger: the roster holds TWO
// hosts and the label answer below holds ONE, and they share no SID. A surface that
// went back to the label prints 1 where 2 is right, and names the wrong host.
const ROSTER = {
  items: [
    { sid: MEMBER.sid, status: 'connected', bound_at: '2026-08-01T00:00:00Z' },
    { sid: 'member-2.local', status: 'connected', bound_at: '2026-08-01T00:00:00Z' },
  ],
  offset: 0,
  limit: 2,
  total: 2,
};

const INCARNATION_ROW = {
  id: INCARNATION_NAME,
  service: 'redis',
  service_version: 'v2.0.0',
  state_schema_version: 3,
  covens: ['prod'],
  state: {},
  status: 'ready',
  created_by_aid: 'archon-alice',
  created_at: '2026-05-20T10:00:00Z',
  updated_at: '2026-05-25T12:00:00Z',
};

// --- 1. the run-target criteria ------------------------------------------------
//
// Two criteria, two sources, and the whole point is that they do not agree. The
// coven half is what keeper's `?coven=` matches; the incarnations half is the
// relation. Reading either from the other is the defect this file exists for.

describe('host criteria — a Coven is the host\'s own label, membership is the relation', () => {
  it('a member carrying no such label is NOT reached by coven=<incarnation name>', () => {
    const c = { ...EMPTY_HOST_CRITERIA, covens: [INCARNATION_NAME] };
    // The server answers the same way: `souls.coven @> ARRAY['redis-prod']` over
    // the row's own column. A client that widened this would target hosts the
    // server's own filter never returns — and it sends explicit SIDs, so nothing
    // downstream would trim them back.
    expect(matchStableCriteria(MEMBER, c, null, new Set([MEMBER.sid]))).toBe(false);
  });

  it('a non-member carrying the label IS reached by coven=<incarnation name>', () => {
    const c = { ...EMPTY_HOST_CRITERIA, covens: [INCARNATION_NAME] };
    // Not a bug to fix by narrowing: the operator asked for a label and this host
    // carries it. Narrowing here to "only real members" would make the client
    // answer a question the server does not, in the opposite direction.
    expect(matchStableCriteria(STRANGER, c, null, new Set([MEMBER.sid]))).toBe(true);
  });

  it('the incarnations criterion reads the roster, and the label does not sway it', () => {
    const c = { ...EMPTY_HOST_CRITERIA, incarnations: [INCARNATION_NAME] };
    const roster = new Set([MEMBER.sid]);
    expect(matchStableCriteria(MEMBER, c, null, roster)).toBe(true);
    expect(matchStableCriteria(STRANGER, c, null, roster)).toBe(false);
  });
});

// --- 2. the Overview "Hosts" card ----------------------------------------------

function renderDetail() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/incarnations/${INCARNATION_NAME}`]}>
          <Routes>
            <Route path="/incarnations/:name" element={<IncarnationDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('incarnation Overview — the Hosts card counts the roster', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('shows the roster total, and never asks the souls list for a coven', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      seen.push(url);
      if (url.includes('/members')) {
        return new Response(JSON.stringify(ROSTER), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith('/v1/souls')) {
        // Answers with the LABELLED set, which shares no SID with the roster. A
        // card that read this would put "1" on screen for a 2-host incarnation.
        return new Response(
          JSON.stringify({ items: [STRANGER], offset: 0, limit: 200, total: 1 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(INCARNATION_ROW), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderDetail();

    await waitFor(() => screen.getByRole('heading', { name: INCARNATION_NAME }));
    // 2 — the roster. The label answer holds 1, so this number alone tells the
    // two sources apart.
    await waitFor(() => expect(screen.getByText(/2 in the roster/i)).toBeInTheDocument());

    expect(seen.some((u) => u.includes(`/v1/incarnations/${INCARNATION_NAME}/members`))).toBe(true);
    expect(seen.some((u) => u.startsWith('/v1/souls') && u.includes('coven='))).toBe(false);
  });
});

// --- 3. the scenario fan-out counts --------------------------------------------

function hookWrapper(qc: QueryClient) {
  return function Wrap({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
}

describe('useIncarnationRosterSizes — how many hosts a scenario will reach', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('counts the roster the operator may see, and never asks the souls list for a coven', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      seen.push(url);
      if (url.startsWith('/v1/souls')) {
        // The LABELLED answer again, one host and no SID in common with the
        // roster. A fan-out that went back to the column counts 1 where 2 is
        // right, so the number below tells the two sources apart on its own —
        // a stub answering the roster to every URL would not.
        return new Response(
          JSON.stringify({ items: [STRANGER], offset: 0, limit: 200, total: 1 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(ROSTER), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const { result } = renderHook(
      () => useIncarnationRosterSizes([INCARNATION_NAME], true),
      { wrapper: hookWrapper(makeQC()) },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sizeByName.get(INCARNATION_NAME)).toBe(2);

    expect(seen.some((u) => u.includes(`/v1/incarnations/${INCARNATION_NAME}/members`))).toBe(true);
    expect(seen.some((u) => u.startsWith('/v1/souls') && u.includes('coven='))).toBe(false);
  });

  it('leaves a name whose roster failed ABSENT rather than zero', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ title: 'Forbidden', detail: 'out of scope' }), {
        status: 403,
        headers: { 'Content-Type': 'application/problem+json' },
      }));

    const { result } = renderHook(
      () => useIncarnationRosterSizes([INCARNATION_NAME], true),
      { wrapper: hookWrapper(makeQC()) },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    // Absent, NOT 0. A caller that defaulted the miss to zero would print a total
    // quietly short of what the run reaches, and nothing on screen would say so.
    expect(result.current.sizeByName.has(INCARNATION_NAME)).toBe(false);
    // And absent WITH A REASON. Absence alone is the same shape as a size still in
    // flight, so a caller holding only the map cannot tell the operator whether to
    // wait, to ask for permissions, or to fix the name.
    expect(result.current.unresolved).toEqual([{ name: INCARNATION_NAME, reason: 'forbidden' }]);
  });

  for (const c of [
    { status: 404, reason: 'unknown' },
    { status: 403, reason: 'forbidden' },
    { status: 500, reason: 'failed' },
  ] as const) {
    it(`reports HTTP ${c.status} as "${c.reason}", because the next step differs`, async () => {
      vi.stubGlobal('fetch', async () =>
        new Response(JSON.stringify({ title: 'nope', detail: 'nope' }), {
          status: c.status,
          headers: { 'Content-Type': 'application/problem+json' },
        }));

      const { result } = renderHook(
        () => useIncarnationRosterSizes([INCARNATION_NAME], true),
        { wrapper: hookWrapper(makeQC()) },
      );

      await waitFor(() => expect(result.current.unresolved.length).toBe(1));
      expect(result.current.unresolved[0].reason).toBe(c.reason);
    });
  }

  it('refuses the whole fan-out past the cap instead of counting part of it', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(ROSTER), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchSpy);

    const names = Array.from({ length: ROSTER_SIZE_FANOUT_LIMIT + 1 }, (_, i) => `inc-${i}`);
    const { result } = renderHook(() => useIncarnationRosterSizes(names, true), {
      wrapper: hookWrapper(makeQC()),
    });

    await waitFor(() => expect(result.current.overCap).toBe(true));
    expect(result.current.sizeByName.size).toBe(0);
    // Not one request: a partial tally reads exactly like a complete one.
    expect(fetchSpy).not.toHaveBeenCalled();
    // Nothing was asked, so nothing FAILED. Listing all 101 names as unresolved
    // would put the wizard's per-name notices on screen next to the cap notice
    // that already explains the one real reason.
    expect(result.current.unresolved).toEqual([]);
  });

  it('the fan-out total is UNKNOWN when one roster is missing, never short', () => {
    // Two names matched, one size known. 4 would be a plausible-looking number and
    // a wrong one: the run reaches those four plus however many the other holds.
    expect(totalRosterSize(['a', 'b'], { a: 4 })).toBeUndefined();
    expect(totalRosterSize(['a', 'b'], { a: 4, b: 3 })).toBe(7);
    // A roster that is genuinely empty is KNOWN to be empty — that is a zero the
    // operator can act on, and it must not be confused with the case above.
    expect(totalRosterSize(['a', 'b'], { a: 4, b: 0 })).toBe(4);
    expect(totalRosterSize(['a'], undefined)).toBeUndefined();
    expect(totalRosterSize([], { a: 4 })).toBe(0);
  });

  it('reads nothing while disabled', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(ROSTER), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchSpy);

    const { result } = renderHook(
      () => useIncarnationRosterSizes([INCARNATION_NAME], false),
      { wrapper: hookWrapper(makeQC()) },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sizeByName.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.unresolved).toEqual([]);
  });
});
