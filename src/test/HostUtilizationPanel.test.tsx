import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installFetchMock } from './fetchMock';
import { renderWithProviders } from './renderWithProviders';
import { HostUtilizationPanel } from '../pages/incarnations/HostUtilizationPanel';

// Prefix-matched fetch routes: the specific soul-telemetry path MUST precede `/v1/souls`
// (the registry list), otherwise the list route would swallow `/v1/souls/<sid>/telemetry`.
const SOUL = '/v1/souls/h1.example.com/telemetry';
const SOULS = '/v1/souls';
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

// Regression fixture (NIM-124): the souls' coven is "dev" while the incarnation is "hello-dev",
// so a coven==name query would return EMPTY. The join must be by SID, not coven.
function soulItem(sid: string, status = 'active') {
  return { sid, status, covens: ['dev'], transport: 'agent' };
}
function soulsBody(items: ReturnType<typeof soulItem>[]) {
  return { items, offset: 0, limit: 500, total: items.length };
}
function aggBody(hosts: unknown[]) {
  return { incarnation: 'hello-dev', truncated: false, hosts };
}

function render() {
  renderWithProviders(<HostUtilizationPanel incarnationName="hello-dev" />);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('HostUtilizationPanel (membership rows ⋈ registry status)', () => {
  it('base rows come from telemetry membership, status joined by SID (coven ≠ name)', async () => {
    installFetchMock([
      { method: 'GET', url: SOULS, body: soulsBody([soulItem('soul-docker-1'), soulItem('soul-docker-2')]) },
      {
        method: 'GET',
        url: AGG,
        body: aggBody([
          { sid: 'soul-docker-1', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST },
          { sid: 'soul-docker-2', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST2 },
        ]),
      },
    ]);
    render();
    // Both member hosts render with util even though their coven is "dev", not "hello-dev".
    await waitFor(() => expect(screen.getByText('42%')).toBeInTheDocument());
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getAllByRole('row').filter((r) => /soul-docker-/.test(r.textContent ?? ''))).toHaveLength(2);
    // Status enriched from the registry.
    expect(screen.getAllByText('active').length).toBe(2);
  });

  it('single host: CPU/mem/disk/net/load/uptime + fresh', async () => {
    installFetchMock([
      { method: 'GET', url: SOULS, body: soulsBody([soulItem('h1.example.com')]) },
      { method: 'GET', url: AGG, body: aggBody([{ sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST }]) },
    ]);
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

  it('host with no registry match → status "—", row still shown (not filtered)', async () => {
    installFetchMock([
      { method: 'GET', url: SOULS, body: soulsBody([]) }, // registry knows nothing
      { method: 'GET', url: AGG, body: aggBody([{ sid: 'orphan.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST }]) },
    ]);
    render();
    await waitFor(() => expect(screen.getByText('42%')).toBeInTheDocument());
    const row = screen.getAllByRole('row').find((r) => (r.textContent ?? '').includes('orphan.example.com'))!;
    const cells = within(row).getAllByRole('cell');
    expect(cells[1].textContent).toBe('—'); // Status column, no registry match
  });

  it('stale telemetry → "stale", not fresh', async () => {
    installFetchMock([
      { method: 'GET', url: SOULS, body: soulsBody([soulItem('h1.example.com')]) },
      { method: 'GET', url: AGG, body: aggBody([{ sid: 'h1.example.com', stale: true, collected_at: '2026-05-26T09:00:00Z', latest: LATEST }]) },
    ]);
    render();
    await waitFor(() => expect(screen.getByTestId('freshness-stale')).toBeInTheDocument());
    expect(screen.queryByTestId('freshness-fresh')).not.toBeInTheDocument();
  });

  it('member host with no latest (legacy agent) → "no data" cell, no expand, no crash', async () => {
    installFetchMock([
      { method: 'GET', url: SOULS, body: soulsBody([soulItem('h1.example.com')]) },
      { method: 'GET', url: AGG, body: aggBody([{ sid: 'h1.example.com', stale: true }]) },
    ]);
    render();
    await waitFor(() => expect(screen.getByTestId('util-nojoin')).toBeInTheDocument());
    expect(screen.getByTestId('freshness-nodata')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Show sparklines for host/)).not.toBeInTheDocument();
  });

  it('no member hosts: telemetry hosts=[] → empty-state, no table', async () => {
    installFetchMock([
      { method: 'GET', url: SOULS, body: soulsBody([]) },
      { method: 'GET', url: AGG, body: aggBody([]) },
    ]);
    render();
    await waitFor(() => expect(screen.getByTestId('util-empty')).toBeInTheDocument());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('telemetry hosts=null → empty-state, no crash', async () => {
    installFetchMock([
      { method: 'GET', url: SOULS, body: soulsBody([]) },
      { method: 'GET', url: AGG, body: { incarnation: 'hello-dev', truncated: false, hosts: null } },
    ]);
    render();
    await waitFor(() => expect(screen.getByTestId('util-empty')).toBeInTheDocument());
  });

  it('telemetry 403: soft forbidden note, no table', async () => {
    installFetchMock([
      { method: 'GET', url: SOULS, body: soulsBody([soulItem('h1.example.com')]) },
      { method: 'GET', url: AGG, status: 403, body: { title: 'forbidden', status: 403 } },
    ]);
    render();
    await waitFor(() => expect(screen.getByTestId('util-forbidden')).toBeInTheDocument());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('telemetry 404 (old Keeper): soft "unavailable", no error-box, no table', async () => {
    installFetchMock([
      { method: 'GET', url: SOULS, body: soulsBody([]) },
      { method: 'GET', url: AGG, status: 404, body: { title: 'not found', status: 404 } },
    ]);
    render();
    await waitFor(() => expect(screen.getByTestId('util-unavailable')).toBeInTheDocument());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(/Failed to load telemetry/)).not.toBeInTheDocument();
  });

  it('sortable columns: default Host asc; click CPU → desc; aria-sort + toggle', async () => {
    installFetchMock([
      { method: 'GET', url: SOULS, body: soulsBody([soulItem('h1.example.com'), soulItem('h2.example.com')]) },
      {
        method: 'GET',
        url: AGG,
        body: aggBody([
          { sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST },
          { sid: 'h2.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST2 },
        ]),
      },
    ]);
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
    installFetchMock([
      { method: 'GET', url: SOULS, body: soulsBody([soulItem('a-nolatest.example.com'), soulItem('h1.example.com')]) },
      {
        method: 'GET',
        url: AGG,
        body: aggBody([
          { sid: 'a-nolatest.example.com', stale: true }, // member, no util
          { sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST },
        ]),
      },
    ]);
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
    installFetchMock([
      { method: 'GET', url: SOULS, body: soulsBody([soulItem('h1.example.com')]) },
      { method: 'GET', url: AGG, body: aggBody([{ sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST }]) },
    ]);
    render();
    await waitFor(() => expect(screen.getByText('2.0 KB/s')).toBeInTheDocument());
    expect(screen.getByText('4.0 KB/s')).toBeInTheDocument();
  });

  it('expand host → shared UtilTrend charts (cpu/mem/load/rx/tx) + inode line', async () => {
    installFetchMock([
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
      { method: 'GET', url: SOULS, body: soulsBody([soulItem('h1.example.com')]) },
      { method: 'GET', url: AGG, body: aggBody([{ sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST }]) },
    ]);
    render();
    const btn = await screen.findByLabelText(/Show sparklines for host/);
    await userEvent.click(btn);
    await screen.findByTestId('host-trends');
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
    installFetchMock([
      { method: 'GET', url: SOUL, body: { sid: 'h1.example.com', stale: false, window: null } },
      { method: 'GET', url: SOULS, body: soulsBody([soulItem('h1.example.com')]) },
      { method: 'GET', url: AGG, body: aggBody([{ sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST }]) },
    ]);
    render();
    const btn = await screen.findByLabelText(/Show sparklines for host/);
    await userEvent.click(btn);
    expect(await screen.findByTestId('spark-empty')).toBeInTheDocument();
  });

  it('Fresh age counts up live between refetches (useNow tick)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T10:00:05Z')); // 5s after collection
    installFetchMock([
      { method: 'GET', url: SOULS, body: soulsBody([soulItem('h1.example.com')]) },
      { method: 'GET', url: AGG, body: aggBody([{ sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST }]) },
    ]);
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
});
