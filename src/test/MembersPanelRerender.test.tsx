import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installFetchMock } from './fetchMock';
import { renderWithProviders } from './renderWithProviders';
import { MembersPanel } from '../pages/incarnations/MembersPanel';

// What this file guards: the freshness column counts up once a second, and that
// tick must reach the freshness cells and NOTHING else.
//
// It used to reach everything. The clock was panel state, so every second the
// panel re-derived the table — two Maps, a Set, the row array, a localeCompare
// sort and the run link's query string — and re-rendered every cell of every row.
// That was bounded while the row source was the telemetry aggregate, which caps
// at 2000 hosts; since NIM-444 the rows come from the roster, and
// `incarnation.ListMembers` has no LIMIT at all, so the per-second cost is a
// function of fleet size (NIM-451).
//
// Two observables stand in for "did the tick re-render it": the number of times
// sortHostRows ran (the derivation) and the number of times a row's SID cell
// rendered (the markup). Both are paired with an assertion that the age on screen
// DID advance — a clock that stopped ticking would otherwise pass every one.
//
// What the counters measure is "did the tick reach this at all", not the rate:
// React coalesces the five `setNow` calls inside one `advanceTimersByTimeAsync`
// into a single render pass, so a broken isolation shows up as one extra pass
// rather than five. That understates the real cost and cannot produce a false
// pass — any panel render at all moves the counter.

const { sortCalls, sidCellRenders } = vi.hoisted(() => ({
  sortCalls: vi.fn(),
  sidCellRenders: vi.fn(),
}));

vi.mock('../pages/incarnations/hostVitals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pages/incarnations/hostVitals')>();
  const sortHostRows: typeof actual.sortHostRows = (rows, key, dir) => {
    sortCalls();
    return actual.sortHostRows(rows, key, dir);
  };
  return { ...actual, sortHostRows };
});

vi.mock('../components/KeeperSidCell', () => ({
  KeeperSidCell: ({ sid }: { sid: string }) => {
    sidCellRenders(sid);
    return <span className="mono">{sid}</span>;
  },
}));

const PERMS = '/v1/me/permissions';
const MEMBERS = '/v1/incarnations/hello-dev/members';
const AGG = '/v1/incarnations/hello-dev/telemetry';
const SOULS = '/v1/souls';

const READ_ONLY = { permissions: [{ resource: 'incarnation', action: 'get', wildcard: false }] };

const LATEST = {
  cpu_pct: 42.3,
  load1: 1.2,
  load5: 0.9,
  load15: 0.7,
  mem_used_mb: 3200,
  mem_total_mb: 8000,
  swap_used_mb: 0,
  uptime_sec: 100000,
  interval_sec: 30,
  net_rx_bps: 2048,
  net_tx_bps: 4096,
  net_err_ps: 0,
  disks: [{ mount: '/', used_mb: 5000, total_mb: 10000, inodes_used: 30000, inodes_total: 100000 }],
};

const SIDS = ['h1.example.com', 'h2.example.com', 'h3.example.com'];

function member(sid: string) {
  return { sid, status: 'connected', bound_at: '2026-07-28T10:00:00Z', bound_by_aid: 'archon-ops' };
}
function telemetry(sid: string, collectedAt: string) {
  return { sid, stale: false, collected_at: collectedAt, latest: LATEST };
}

// All three hosts collected at the same instant, five seconds before "now" — so
// every freshness cell reads "5s ago" and moves together.
function install(collectedAt = '2026-05-26T10:00:00Z') {
  installFetchMock([
    { method: 'GET', url: PERMS, body: READ_ONLY },
    { method: 'GET', url: MEMBERS, body: { items: SIDS.map(member), offset: 0, limit: 50, total: SIDS.length } },
    {
      method: 'GET',
      url: AGG,
      body: { incarnation: 'hello-dev', truncated: false, hosts: SIDS.map((s) => telemetry(s, collectedAt)) },
    },
    {
      method: 'GET',
      url: SOULS,
      body: {
        items: SIDS.map((sid) => ({ sid, status: 'connected', covens: ['dev'], transport: 'agent' })),
        offset: 0,
        limit: 500,
        total: SIDS.length,
      },
    },
  ]);
}

// Renders and lets all four queries land, so the counters below start from a
// settled table rather than from a half-loaded one.
async function renderSettled() {
  renderWithProviders(<MembersPanel incarnationName="hello-dev" />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getAllByTestId('freshness-fresh')).toHaveLength(SIDS.length);
  expect(screen.getAllByText('42%')).toHaveLength(SIDS.length);
  expect(screen.getAllByText('connected')).toHaveLength(SIDS.length);
}

const ages = () => screen.getAllByTestId('freshness-fresh').map((el) => (el.textContent ?? '').trim());

describe('MembersPanel — the freshness tick is confined to the freshness cells', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T10:00:05Z'));
    sortCalls.mockClear();
    sidCellRenders.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not re-derive the table — not on a tick, not on a render that changes no data', async () => {
    install();
    await renderSettled();
    const derivations = sortCalls.mock.calls.length;
    expect(derivations).toBeGreaterThan(0);

    // Five ticks, all under the 15s refetch — nothing but the clock changes.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(ages()).toEqual(['10s ago', '10s ago', '10s ago']);
    expect(sortCalls.mock.calls.length).toBe(derivations);

    // …and on a re-render with no clock in it at all: expanding a row is panel
    // state over the same table. This half is what holds the memo itself in place
    // — a tick that no longer reaches the panel has nothing to recompute either
    // way, so it cannot tell a memoized derivation from an unmemoized one.
    fireEvent.click(screen.getAllByLabelText(/Show details for host/)[0]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('member-facts')).toBeInTheDocument();
    expect(sortCalls.mock.calls.length).toBe(derivations);
  });

  it('does not re-render the rows', async () => {
    install();
    await renderSettled();
    const rowRenders = sidCellRenders.mock.calls.length;
    expect(rowRenders).toBeGreaterThan(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(ages()).toEqual(['10s ago', '10s ago', '10s ago']);
    expect(sidCellRenders.mock.calls.length).toBe(rowRenders);
  });

  // The other half of the same rule: a reply that actually changes the table must
  // still rebuild it. A memo keyed on the wrong thing would pass both tests above
  // by never recomputing at all.
  it('still re-derives when the roster reply changes', async () => {
    let rosterCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const json = (obj: unknown) =>
          new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (url.startsWith(PERMS)) return json(READ_ONLY);
        if (url.startsWith(MEMBERS)) {
          rosterCalls += 1;
          const items = rosterCalls === 1 ? SIDS.map(member) : SIDS.slice(0, 2).map(member);
          return json({ items, offset: 0, limit: 50, total: items.length });
        }
        if (url.startsWith(AGG)) return json({ incarnation: 'hello-dev', truncated: false, hosts: [] });
        if (url.startsWith(SOULS)) return json({ items: [], offset: 0, limit: 500, total: 0 });
        return new Response(JSON.stringify({ title: 'not mocked', detail: url }), { status: 599 });
      }),
    );

    renderWithProviders(<MembersPanel incarnationName="hello-dev" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('h3.example.com')).toBeInTheDocument();
    const derivations = sortCalls.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
    });

    expect(rosterCalls).toBeGreaterThan(1);
    expect(screen.queryByText('h3.example.com')).not.toBeInTheDocument();
    expect(sortCalls.mock.calls.length).toBeGreaterThan(derivations);
  });

  // The roster is not the only input, and the souls registry is the one whose
  // whole reason for being polled is that it changes: presence is read from
  // `GET /v1/souls` precisely because it overlays PG with the live stream lease,
  // while the roster's own `status` column is a snapshot the Reaper reconciles
  // lazily (NIM-444). A dot that froze at whatever the first reply said would put
  // this panel back to reporting a dead host as connected — which is the defect
  // the souls query was added to fix, reintroduced through a memo.
  it('still re-derives when only the souls reply changes — a dot that went out stops being green', async () => {
    let soulsCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const json = (obj: unknown) =>
          new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (url.startsWith(PERMS)) return json(READ_ONLY);
        // The roster answers the same bytes throughout, and says `connected` —
        // so a stale dot cannot be blamed on the roster having changed.
        if (url.startsWith(MEMBERS)) {
          const items = [member('h1.example.com')];
          return json({ items, offset: 0, limit: 50, total: 1 });
        }
        if (url.startsWith(AGG)) return json({ incarnation: 'hello-dev', truncated: false, hosts: [] });
        if (url.startsWith(SOULS)) {
          soulsCalls += 1;
          const status = soulsCalls === 1 ? 'connected' : 'disconnected';
          return json({
            items: [{ sid: 'h1.example.com', status, covens: ['dev'], transport: 'agent' }],
            offset: 0,
            limit: 500,
            total: 1,
          });
        }
        return new Response(JSON.stringify({ title: 'not mocked', detail: url }), { status: 599 });
      }),
    );

    renderWithProviders(<MembersPanel incarnationName="hello-dev" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('connected')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
    });

    expect(soulsCalls).toBeGreaterThan(1);
    expect(screen.getByText('disconnected')).toBeInTheDocument();
    expect(screen.queryByText('connected')).not.toBeInTheDocument();
  });
});

// Real timers: this one drives the header with userEvent and has no clock to
// advance — the point is the ORDER, which no longer comes from a clock at all.
describe('MembersPanel — the Fresh column', () => {
  // The Fresh column had no test of its own, and it is the one column whose
  // ordering is now derived from a timestamp rather than from an age. Same order
  // either way — but only if the sign is right.
  it('sorting by Fresh puts the newest snapshot on top and sinks hosts with none', async () => {
    installFetchMock([
      { method: 'GET', url: PERMS, body: READ_ONLY },
      {
        method: 'GET',
        url: MEMBERS,
        body: {
          items: ['new.example.com', 'old.example.com', 'quiet.example.com'].map(member),
          offset: 0,
          limit: 50,
          total: 3,
        },
      },
      {
        method: 'GET',
        url: AGG,
        body: {
          incarnation: 'hello-dev',
          truncated: false,
          hosts: [
            telemetry('old.example.com', '2026-05-26T09:00:00Z'),
            telemetry('new.example.com', '2026-05-26T10:00:00Z'),
          ],
        },
      },
      { method: 'GET', url: SOULS, body: { items: [], offset: 0, limit: 500, total: 0 } },
    ]);
    renderWithProviders(<MembersPanel incarnationName="hello-dev" />);
    await screen.findByText('quiet.example.com');

    const order = () =>
      screen
        .getAllByRole('row')
        .map((r) => r.textContent ?? '')
        .filter((tx) => tx.includes('.example.com'))
        .map((tx) => tx.slice(0, tx.indexOf('.example.com')));

    const user = userEvent.setup();
    await user.click(screen.getByTestId('host-th-fresh'));
    expect(screen.getByTestId('host-th-fresh')).toHaveAttribute('aria-sort', 'ascending');
    expect(order()).toEqual(['new', 'old', 'quiet']);

    await user.click(screen.getByTestId('host-th-fresh'));
    expect(screen.getByTestId('host-th-fresh')).toHaveAttribute('aria-sort', 'descending');
    expect(order()).toEqual(['old', 'new', 'quiet']);
  });
});
