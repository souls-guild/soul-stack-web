import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installFetchMock, type FetchRoute } from './fetchMock';
import { renderWithProviders } from './renderWithProviders';
import { MembersPanel } from '../pages/incarnations/MembersPanel';

// The vitals half of the merged roster panel (NIM-444): utilization columns,
// sorting, freshness, the on-demand trend expansion, and the run link (NIM-443).
// The roster half — bind/unbind and the permission gates — lives in
// MembersPanel.test.tsx.
//
// The invariant this file exists for: a row is on screen because the host is a
// MEMBER. Telemetry only fills the columns, so losing it degrades cells to "—"
// and never removes a host from the list.

// Prefix-matched fetch routes: the specific soul-telemetry path MUST precede
// `/v1/souls` if that ever comes back as a route here.
const SOUL = '/v1/souls/h1.example.com/telemetry';
const SOULS = '/v1/souls';
const PERMS = '/v1/me/permissions';
const MEMBERS = '/v1/incarnations/hello-dev/members';
const AGG = '/v1/incarnations/hello-dev/telemetry';

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
const LATEST2 = { ...LATEST, cpu_pct: 80, load1: 4.0, net_rx_bps: 100, net_tx_bps: 100 };

// Read-only rights: no bind/unbind controls, so the table is the plain vitals grid.
const READ_ONLY = { permissions: [{ resource: 'incarnation', action: 'get', wildcard: false }] };
// With unbind the table grows a trailing action column — the merged table's width
// is now a function of the caller's rights, which the colSpans have to follow.
const CAN_UNBIND = {
  permissions: [
    { resource: 'incarnation', action: 'get', wildcard: false },
    { resource: 'incarnation', action: 'unbind-member', wildcard: false },
  ],
};

function memberItem(sid: string, status = 'connected') {
  return { sid, status, bound_at: '2026-07-28T10:00:00Z', bound_by_aid: 'archon-ops' };
}
function membersBody(items: unknown[]) {
  return { items, offset: 0, limit: 50, total: items.length };
}
function aggBody(hosts: unknown[]) {
  return { incarnation: 'hello-dev', truncated: false, hosts };
}

function soulsBody(items: unknown[]) {
  return { items, offset: 0, limit: 500, total: items.length };
}

// Every fixture answers all three: the roster puts rows on screen, the aggregate
// fills their columns, the registry resolves presence. The `/v1/souls` route goes
// LAST — it is a prefix of the per-soul telemetry path and would swallow it.
function mock(members: FetchRoute, agg: FetchRoute, extra: FetchRoute[] = [], souls: unknown[] = []) {
  installFetchMock([
    ...extra,
    { method: 'GET', url: PERMS, body: READ_ONLY },
    members,
    agg,
    { method: 'GET', url: SOULS, body: soulsBody(souls) },
  ]);
}
function roster(items: unknown[], agg: unknown[], extra: FetchRoute[] = [], souls: unknown[] = []) {
  mock(
    { method: 'GET', url: MEMBERS, body: membersBody(items) },
    { method: 'GET', url: AGG, body: aggBody(agg) },
    extra,
    souls,
  );
}

function render() {
  renderWithProviders(<MembersPanel incarnationName="hello-dev" />);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('MembersPanel — vitals (roster rows ⋈ telemetry)', () => {
  it('rows come from the roster, utilization joined by SID', async () => {
    roster(
      [memberItem('soul-docker-1'), memberItem('soul-docker-2')],
      [
        { sid: 'soul-docker-1', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST },
        { sid: 'soul-docker-2', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST2 },
      ],
    );
    render();
    await waitFor(() => expect(screen.getByText('42%')).toBeInTheDocument());
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getAllByRole('row').filter((r) => /soul-docker-/.test(r.textContent ?? ''))).toHaveLength(2);
    expect(screen.getAllByText('connected').length).toBe(2);
  });

  // The two replies carry a `status` field for the same host and they DISAGREE in
  // practice: `GET /v1/souls` overlays the PG column with the live stream lease,
  // while the roster returns that column raw — a last-known snapshot the Reaper
  // reconciles lazily. Observed on a running Keeper: a host whose agent had been
  // dead for minutes was still `connected` in the roster reply. The dot has to be
  // the live one, or it stops being a connection indicator at all.
  it('presence comes from the souls registry, not the roster’s stale status column', async () => {
    roster(
      [memberItem('h1.example.com', 'connected')],
      [{ sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST }],
      [],
      [{ sid: 'h1.example.com', status: 'disconnected', covens: ['dev'], transport: 'agent' }],
    );
    render();
    await waitFor(() => expect(screen.getByText('disconnected')).toBeInTheDocument());
    expect(screen.queryByText('connected')).not.toBeInTheDocument();
  });

  // …but a host the registry page did not return keeps the roster's value rather
  // than losing its status entirely: for pending/revoked/expired that column is
  // authoritative anyway — the lease overlay does not touch lifecycle statuses.
  it('a member missing from the registry page falls back to the roster status', async () => {
    roster([memberItem('beyond-the-page.example.com', 'pending')], [], [], []);
    render();
    await waitFor(() => expect(screen.getByTestId('members-table')).toBeInTheDocument());
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('single host: CPU/mem/disk/net/load/uptime + fresh', async () => {
    roster(
      [memberItem('h1.example.com')],
      [{ sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST }],
    );
    render();
    await waitFor(() => expect(screen.getByText('42%')).toBeInTheDocument());
    expect(screen.getByText('3.1 GB / 7.8 GB')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument(); // busiest disk
    expect(screen.getByText('2.0 KB/s')).toBeInTheDocument(); // net rx
    expect(screen.getByText('4.0 KB/s')).toBeInTheDocument(); // net tx
    expect(screen.getByText('1.20')).toBeInTheDocument(); // load1
    expect(screen.getByText('1d 3h')).toBeInTheDocument(); // uptime
    expect(screen.getByTestId('freshness-fresh')).toBeInTheDocument();
  });

  // THE point of the merge. A member the aggregate says nothing about used to
  // have no row at all, because the aggregate WAS the row source.
  it('member with no telemetry → row with dashes, not a missing host', async () => {
    roster([memberItem('quiet.example.com')], []);
    render();
    await waitFor(() => expect(screen.getByTestId('members-table')).toBeInTheDocument());
    expect(screen.getByText('quiet.example.com')).toBeInTheDocument();
    expect(screen.getByTestId('util-nojoin')).toBeInTheDocument();
    expect(screen.getByTestId('freshness-nodata')).toBeInTheDocument();
    // …and the panel says why every metric is blank rather than leaving it a mystery.
    expect(screen.getByTestId('util-empty')).toBeInTheDocument();
  });

  // Telemetry scopes the same relation through a slightly wider gate (inherited
  // labels), and a bind can land between the two fetches. Such a host is still a
  // member — dropping it would hide a host the previous UI did show.
  it('telemetry host the roster reply did not carry → row still shown, status "—"', async () => {
    roster(
      [],
      [{ sid: 'orphan.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST }],
    );
    render();
    await waitFor(() => expect(screen.getByText('42%')).toBeInTheDocument());
    const row = screen.getAllByRole('row').find((r) => (r.textContent ?? '').includes('orphan.example.com'))!;
    const cells = within(row).getAllByRole('cell');
    expect(cells[1].textContent).toBe('—'); // Status column, no roster entry
  });

  it('stale telemetry → "stale", not fresh', async () => {
    roster(
      [memberItem('h1.example.com')],
      [{ sid: 'h1.example.com', stale: true, collected_at: '2026-05-26T09:00:00Z', latest: LATEST }],
    );
    render();
    await waitFor(() => expect(screen.getByTestId('freshness-stale')).toBeInTheDocument());
    expect(screen.queryByTestId('freshness-fresh')).not.toBeInTheDocument();
  });

  it('member host with no latest (legacy agent) → "no data" cell, no crash', async () => {
    roster([memberItem('h1.example.com')], [{ sid: 'h1.example.com', stale: true }]);
    render();
    await waitFor(() => expect(screen.getByTestId('util-nojoin')).toBeInTheDocument());
    expect(screen.getByTestId('freshness-nodata')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('empty roster and empty aggregate → the roster empty-state, no table', async () => {
    roster([], []);
    render();
    await waitFor(() => expect(screen.getByTestId('members-empty')).toBeInTheDocument());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    // Nothing on the roster is not a telemetry problem — don't say it twice.
    expect(screen.queryByTestId('util-empty')).not.toBeInTheDocument();
  });

  it('telemetry hosts=null → no crash', async () => {
    mock(
      { method: 'GET', url: MEMBERS, body: membersBody([]) },
      { method: 'GET', url: AGG, body: { incarnation: 'hello-dev', truncated: false, hosts: null } },
    );
    render();
    await waitFor(() => expect(screen.getByTestId('members-empty')).toBeInTheDocument());
  });

  // The contradiction the merge removes: the roster above said "two hosts", this
  // section said "none", and both were on the same screen. The reachable way to
  // lose the aggregate is an older Keeper (404) or the subsystem being off (501)
  // — NOT a missing permission, see the "one explanation" case below.
  it('telemetry 404 (old Keeper): roster rows stay, soft "unavailable", no error-box', async () => {
    mock(
      { method: 'GET', url: MEMBERS, body: membersBody([memberItem('h1.example.com'), memberItem('h2.example.com')]) },
      { method: 'GET', url: AGG, status: 404, body: { title: 'not found', status: 404 } },
    );
    render();
    await waitFor(() => expect(screen.getByTestId('util-unavailable')).toBeInTheDocument());
    expect(screen.getByTestId('members-table')).toBeInTheDocument();
    expect(screen.getAllByTestId('util-nojoin')).toHaveLength(2);
    expect(screen.queryByTestId('members-empty')).not.toBeInTheDocument();
    expect(screen.queryByText(/Failed to load telemetry/)).not.toBeInTheDocument();
  });

  // There is no telemetry permission of its own: the aggregate is gated by the
  // bare `incarnation.get` action and the roster by that action WITH a scope
  // selector, so 403 always arrives on both at once. One missing right, one
  // explanation — not two boxes saying the same thing.
  it('both endpoints 403 → the roster explanation only', async () => {
    mock(
      {
        method: 'GET',
        url: MEMBERS,
        status: 403,
        body: { title: 'forbidden', detail: 'permission incarnation.get required' },
      },
      { method: 'GET', url: AGG, status: 403, body: { title: 'forbidden', status: 403 } },
    );
    render();
    await waitFor(() => expect(screen.getByTestId('members-forbidden')).toBeInTheDocument());
    expect(screen.queryByTestId('util-forbidden')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  // The mirror case: no right to read the roster, but telemetry answers. The
  // hosts it names are members too, so they are still worth showing.
  it('roster 403 with telemetry readable → rows from telemetry + the roster note', async () => {
    mock(
      {
        method: 'GET',
        url: MEMBERS,
        status: 403,
        body: { title: 'forbidden', detail: 'permission incarnation.get required' },
      },
      {
        method: 'GET',
        url: AGG,
        body: aggBody([{ sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST }]),
      },
    );
    render();
    await waitFor(() => expect(screen.getByTestId('members-forbidden')).toBeInTheDocument());
    expect(screen.getByTestId('members-table')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('sortable columns: default Host asc; click CPU → desc; aria-sort + toggle', async () => {
    roster(
      [memberItem('h1.example.com'), memberItem('h2.example.com')],
      [
        { sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST },
        { sid: 'h2.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST2 },
      ],
    );
    render();
    await waitFor(() => expect(screen.getByText('42%')).toBeInTheDocument());

    const rowSids = () =>
      screen
        .getAllByRole('row')
        .map((r) => r.textContent ?? '')
        .filter((tx) => tx.includes('h1.example.com') || tx.includes('h2.example.com'));

    expect(screen.getByTestId('host-th-host')).toHaveAttribute('aria-sort', 'ascending');
    let order = rowSids();
    expect(order[0]).toContain('h1.example.com');
    expect(order[1]).toContain('h2.example.com');

    await userEvent.click(screen.getByTestId('host-th-cpu'));
    expect(screen.getByTestId('host-th-cpu')).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByTestId('host-th-host')).toHaveAttribute('aria-sort', 'none');
    order = rowSids();
    expect(order[0]).toContain('h2.example.com'); // 80% on top
    expect(order[1]).toContain('h1.example.com');

    await userEvent.click(screen.getByTestId('host-th-cpu'));
    expect(screen.getByTestId('host-th-cpu')).toHaveAttribute('aria-sort', 'ascending');
    order = rowSids();
    expect(order[0]).toContain('h1.example.com');
  });

  it('sort by util column sinks no-latest hosts to the bottom', async () => {
    roster(
      [memberItem('a-nolatest.example.com'), memberItem('h1.example.com')],
      [
        { sid: 'a-nolatest.example.com', stale: true }, // member, no util
        { sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST },
      ],
    );
    render();
    await waitFor(() => expect(screen.getByText('42%')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('host-th-cpu'));
    const order = screen
      .getAllByRole('row')
      .map((r) => r.textContent ?? '')
      .filter((tx) => tx.includes('.example.com'));
    expect(order[0]).toContain('h1.example.com');
    expect(order[order.length - 1]).toContain('a-nolatest.example.com');
  });

  it('net column: rx/tx throughput per host', async () => {
    roster(
      [memberItem('h1.example.com')],
      [{ sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST }],
    );
    render();
    await waitFor(() => expect(screen.getByText('2.0 KB/s')).toBeInTheDocument());
    expect(screen.getByText('4.0 KB/s')).toBeInTheDocument();
  });

  it('expand host → membership facts + shared UtilTrend charts + inode line', async () => {
    roster(
      [memberItem('h1.example.com')],
      [{ sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST }],
      [
        {
          method: 'GET',
          url: SOUL,
          body: {
            sid: 'h1.example.com',
            stale: false,
            collected_at: '2026-05-26T10:00:00Z',
            received_at: '2026-05-26T10:00:01Z',
            latest: LATEST,
            window: [
              { collected_at: '2026-05-26T10:00:00Z', cpu_pct: 60, load1: 1.5, mem_used_mb: 5000, mem_total_mb: 8000, net_rx_bps: 3000, net_tx_bps: 1000 },
              { collected_at: '2026-05-26T09:59:00Z', cpu_pct: 50, load1: 1.0, mem_used_mb: 4000, mem_total_mb: 8000, net_rx_bps: 2000, net_tx_bps: 800 },
            ],
          },
        },
      ],
    );
    render();
    const btn = await screen.findByLabelText(/Show details for host/);
    await userEvent.click(btn);
    await screen.findByTestId('host-trends');
    expect(screen.getByTestId('member-facts')).toHaveTextContent('archon-ops');
    for (const id of ['host-trend-cpu', 'host-trend-mem', 'host-trend-load', 'host-trend-rx', 'host-trend-tx']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    // The window has 2 chronological points → the CPU chart plots 2.
    const cpuSvg = within(screen.getByTestId('host-trend-cpu')).getByRole('img');
    expect(cpuSvg.getAttribute('data-points')).toBe('2');
    const inodes = screen.getByTestId('spark-inodes');
    expect(inodes).toHaveTextContent('30%');
    expect(inodes).toHaveTextContent('/');
  });

  it('expand: window=null → "window empty", no crash', async () => {
    roster(
      [memberItem('h1.example.com')],
      [{ sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST }],
      [{ method: 'GET', url: SOUL, body: { sid: 'h1.example.com', stale: false, window: null } }],
    );
    render();
    const btn = await screen.findByLabelText(/Show details for host/);
    await userEvent.click(btn);
    expect(await screen.findByTestId('spark-empty')).toBeInTheDocument();
  });

  // A member with no metrics is still expandable — the expansion also carries the
  // membership facts — but there is no window to ask for, so no per-soul request
  // goes out for it.
  it('expand a member with no telemetry → facts only, no per-soul request', async () => {
    roster([memberItem('quiet.example.com')], []);
    render();
    const btn = await screen.findByLabelText(/Show details for host/);
    await userEvent.click(btn);
    expect(await screen.findByTestId('member-facts')).toHaveTextContent('archon-ops');
    expect(screen.queryByTestId('host-trends')).not.toBeInTheDocument();
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.map((c) => String(c[0])).some((u) => u.includes('/v1/souls/'))).toBe(false);
  });

  it('Fresh age counts up live between refetches (useNow tick)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T10:00:05Z')); // 5s after collection
    roster(
      [memberItem('h1.example.com')],
      [{ sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST }],
    );
    render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('freshness-fresh')).toHaveTextContent('5s ago');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByTestId('freshness-fresh')).toHaveTextContent('8s ago');
  });

  // The roster decides which hosts exist on screen, so it has to keep polling.
  // While it was a table of its own it did not, and the row set self-corrected
  // only because the OTHER table (telemetry) was the one being polled.
  //
  // A host unbound elsewhere must also leave the run target — an arbitrary
  // command reaching a host that is no longer a member is the bug NIM-443 fixed.
  // Since NIM-451 the link cannot carry a stale host at all, because it carries
  // no host list: it names the incarnation, and the wizard reads the roster when
  // the run is submitted. So the assertion here is the stronger one — the link
  // never mentions a SID — plus the row leaving the table on the next poll. That
  // the wizard then targets the CURRENT roster is guarded on its own side, in
  // RunWizard.test.tsx.
  it('a host unbound elsewhere leaves the table, and the run link never carried it', async () => {
    vi.useFakeTimers();
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
          // First answer: both hosts. Every answer after it: host-b is gone.
          return json(
            membersBody(
              rosterCalls === 1
                ? [memberItem('h1.example.com'), memberItem('h2.example.com')]
                : [memberItem('h1.example.com')],
            ),
          );
        }
        if (url.startsWith(AGG)) return json(aggBody([]));
        return new Response(JSON.stringify({ title: 'not mocked', detail: url }), { status: 599 });
      }),
    );

    render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('h2.example.com')).toBeInTheDocument();
    expect(screen.getByTestId('run-on-hosts').getAttribute('href')).not.toContain('h2.example.com');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
    });
    expect(rosterCalls).toBeGreaterThan(1);
    expect(screen.queryByText('h2.example.com')).not.toBeInTheDocument();
    expect(screen.getByTestId('run-on-hosts').getAttribute('href')).not.toContain('h2.example.com');
  });

  // Merging the two tables made the width depend on the caller's rights, and three
  // different colSpans now have to agree with it: the no-telemetry cell spanning the
  // six metric columns, the expansion spanning the whole row, and the header itself.
  // A mismatch does not throw — the browser just renders a ragged table.
  describe.each([
    ['read-only', READ_ONLY],
    ['with unbind', CAN_UNBIND],
  ])('column count stays consistent (%s)', (_label, perms) => {
    it('header, a row with metrics, a row without, and the expansion are all the same width', async () => {
      installFetchMock([
        { method: 'GET', url: PERMS, body: perms },
        {
          method: 'GET',
          url: MEMBERS,
          body: membersBody([memberItem('h1.example.com'), memberItem('quiet.example.com')]),
        },
        {
          method: 'GET',
          url: AGG,
          body: aggBody([{ sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST }]),
        },
      ]);
      render();
      await waitFor(() => expect(screen.getByText('42%')).toBeInTheDocument());

      const span = (cell: HTMLElement) => Number(cell.getAttribute('colspan')) || 1;
      const width = (cells: HTMLElement[]) => cells.reduce((n, c) => n + span(c), 0);

      const headerWidth = width(screen.getAllByRole('columnheader'));
      const rowWith = screen.getAllByRole('row').find((r) => (r.textContent ?? '').includes('h1.example.com'))!;
      const rowWithout = screen.getAllByRole('row').find((r) => (r.textContent ?? '').includes('quiet.example.com'))!;
      expect(width(within(rowWith).getAllByRole('cell'))).toBe(headerWidth);
      expect(width(within(rowWithout).getAllByRole('cell'))).toBe(headerWidth);

      await userEvent.click(screen.getByLabelText('Show details for host h1.example.com'));
      const expansion = screen.getAllByRole('row').find((r) => within(r).queryByTestId('member-facts'))!;
      expect(width(within(expansion).getAllByRole('cell'))).toBe(headerWidth);
    });
  });

  // NIM-443: the button says "these hosts", and those hosts are the membership
  // roster. `target_coven=<incarnation name>` is a DIFFERENT set since NIM-124 —
  // a Coven is a label, membership is the relation — so the link must never fall
  // back to it however convenient the matching name looks.
  //
  // It names the roster rather than enumerating it (NIM-451). Enumerating grew
  // the URL with the fleet until a reload of it answered 431 against Keeper's
  // 16 KiB header cap; the wizard resolves the name through the same roster
  // endpoint under the same query key, so the two cannot disagree about what
  // "these hosts" means.
  it('Run command names the incarnation as a membership target, never as a coven label', async () => {
    roster(
      [memberItem('soul-docker-1'), memberItem('soul-docker-2')],
      [
        { sid: 'soul-docker-1', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST },
        { sid: 'soul-docker-2', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST2 },
      ],
    );
    render();
    // Read the link only once the rows are on screen: before the fetch resolves
    // the panel has nothing to target, and an empty target would pass the
    // "no coven" half of this assertion for the wrong reason.
    await waitFor(() => expect(screen.getByText('42%')).toBeInTheDocument());
    const href = screen.getByTestId('run-on-hosts').getAttribute('href') ?? '';
    const query = new URLSearchParams(href.slice(href.indexOf('?')));
    expect(query.get('workload')).toBe('command');
    expect(query.get('target_incarnation')).toBe('hello-dev');
    expect(query.has('target_coven')).toBe(false);
  });

  // The link cannot grow with the roster — that is the whole reason it names the
  // set instead of listing it. A thousand members must produce the same URL as
  // two, and it must stay far under the 16 KiB Keeper accepts in headers.
  it('Run command link is the same length whatever the roster size', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => memberItem(`bulk-${String(i).padStart(6, '0')}.example.com`));
    roster(many, []);
    render();
    await waitFor(() => expect(screen.getByTestId('members-table')).toBeInTheDocument());
    const href = screen.getByTestId('run-on-hosts').getAttribute('href') ?? '';
    expect(href).toBe('/run?workload=command&target_incarnation=hello-dev');
    expect(href.length).toBeLessThan(512);
  });

  // Sorting reorders the table, not the set the run reaches: a link that changed
  // under a column click would make the target look like a function of the view.
  it('Run command target is unchanged by a column sort', async () => {
    roster(
      [memberItem('h1.example.com'), memberItem('h2.example.com')],
      [
        { sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST },
        { sid: 'h2.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST2 },
      ],
    );
    render();
    await waitFor(() => expect(screen.getByText('42%')).toBeInTheDocument());
    const before = screen.getByTestId('run-on-hosts').getAttribute('href');
    expect(before).toContain('target_incarnation=hello-dev');
    await userEvent.click(screen.getByTestId('host-th-cpu'));
    expect(screen.getByTestId('run-on-hosts').getAttribute('href')).toBe(before);
  });

  // No rows means no honest target. The old link still offered a run — onto the
  // coven, i.e. onto hosts the operator was not being shown.
  it('no rows → Run command is disabled, not a link to everything', async () => {
    roster([], []);
    render();
    await waitFor(() => expect(screen.getByTestId('members-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('run-on-hosts')).not.toBeInTheDocument();
    expect(screen.getByTestId('run-on-hosts-disabled')).toBeDisabled();
  });
});
