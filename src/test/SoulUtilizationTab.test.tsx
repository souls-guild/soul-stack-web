import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { SoulDetail } from '../pages/souls/SoulDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

function soulRoute(sid: string) {
  return {
    method: 'GET' as const,
    url: `/v1/souls/${sid}`,
    body: {
      sid,
      transport: 'agent',
      status: 'connected',
      covens: ['prod'],
      registered_at: '2026-05-01T00:00:00Z',
    },
  };
}

function renderAt(sid: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/souls/:sid" element={<SoulDetail />} />
    </Routes>,
    `/souls/${sid}`,
  );
}

describe('SoulUtilizationTab', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('renders latest gauges + sparklines + disk inodes', async () => {
    installFetchMock([
      // telemetry route BEFORE the soul route: both share the prefix, first wins.
      {
        method: 'GET',
        url: '/v1/souls/host01.example.com/telemetry',
        body: {
          sid: 'host01.example.com',
          stale: false,
          collected_at: '2026-05-26T09:59:50Z',
          received_at: '2026-05-26T10:00:00Z',
          latest: {
            cpu_pct: 42,
            load1: 1.5,
            load5: 1.2,
            load15: 0.9,
            mem_used_mb: 8000,
            mem_total_mb: 16000,
            swap_used_mb: 128,
            uptime_sec: 90000,
            net_rx_bps: 2048,
            net_tx_bps: 4096,
            net_err_ps: 0,
            interval_sec: 15,
            disks: [
              { mount: '/', used_mb: 20000, total_mb: 50000, inodes_used: 100000, inodes_total: 500000 },
              { mount: '/data', used_mb: 900, total_mb: 1000, inodes_used: 0, inodes_total: 0 },
            ],
          },
          window: [
            { collected_at: '2026-05-26T09:59:50Z', cpu_pct: 42, load1: 1.5, mem_used_mb: 8000, mem_total_mb: 16000, net_rx_bps: 2048, net_tx_bps: 4096 },
            { collected_at: '2026-05-26T09:59:35Z', cpu_pct: 30, load1: 1.0, mem_used_mb: 7000, mem_total_mb: 16000, net_rx_bps: 1024, net_tx_bps: 2048 },
          ],
        },
      },
      soulRoute('host01.example.com'),
    ]);
    renderAt('host01.example.com');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'host01.example.com' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Utilization' }));

    await waitFor(() => {
      expect(screen.getByTestId('soul-util-tab')).toBeInTheDocument();
    });

    // latest CPU value (radial center + trend "now" both show it)
    expect(screen.getAllByText('42%').length).toBeGreaterThan(0);
    // radial gauges render
    expect(screen.getByTestId('soul-radial-cpu')).toBeInTheDocument();
    expect(screen.getByTestId('soul-radial-mem')).toBeInTheDocument();
    expect(screen.getByTestId('soul-radial-disk')).toBeInTheDocument();
    // trend mini-charts render
    expect(screen.getByTestId('soul-trend-cpu')).toBeInTheDocument();
    expect(screen.getByTestId('soul-trend-rx')).toBeInTheDocument();
    // approximate y-axis: max / mid / min labels over the plotted 0..100 range
    const cpuTrend = within(screen.getByTestId('soul-trend-cpu'));
    expect(cpuTrend.getByText('100%')).toBeInTheDocument();
    expect(cpuTrend.getByText('50%')).toBeInTheDocument();
    expect(cpuTrend.getByText('0%')).toBeInTheDocument();
    // Net axis uses the terse compact format ("2 KB/s", not "2.0 KB/s") so it fits the gutter
    const rxTrend = within(screen.getByTestId('soul-trend-rx'));
    expect(rxTrend.getByText('2 KB/s')).toBeInTheDocument();
    // disk table: mount (also shown as the Disk radial sub) + inode "n/a"
    expect(screen.getAllByText('/data').length).toBeGreaterThan(0);
    expect(screen.getByText('n/a')).toBeInTheDocument();
    // busiest mount on top: /data (90%) before / (40%)
    const diskRows = screen.getByTestId('soul-util-disks').querySelectorAll('tbody tr');
    expect(diskRows[0].querySelector('td')?.textContent).toBe('/data');
  });

  it('disk table columns are click-to-sort with a caret on the active column', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/souls/host03.example.com/telemetry',
        body: {
          sid: 'host03.example.com',
          stale: false,
          collected_at: '2026-05-26T10:00:00Z',
          latest: {
            cpu_pct: 10, load1: 0.1, load5: 0.1, load15: 0.1,
            mem_used_mb: 1000, mem_total_mb: 2000, swap_used_mb: 0, uptime_sec: 100,
            net_rx_bps: 0, net_tx_bps: 0, net_err_ps: 0, interval_sec: 15,
            disks: [
              { mount: '/var', used_mb: 30, total_mb: 100, inodes_used: 90, inodes_total: 100 }, // sp30 ino90
              { mount: '/data', used_mb: 90, total_mb: 100, inodes_used: 10, inodes_total: 100 }, // sp90 ino10
              { mount: '/', used_mb: 60, total_mb: 100, inodes_used: 50, inodes_total: 100 }, // sp60 ino50
            ],
          },
        },
      },
      soulRoute('host03.example.com'),
    ]);
    renderAt('host03.example.com');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'host03.example.com' })).toBeInTheDocument();
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Utilization' }));
    await waitFor(() => expect(screen.getByTestId('soul-util-disks')).toBeInTheDocument());

    const mountOrder = () =>
      [...screen.getByTestId('soul-util-disks').querySelectorAll('tbody tr')].map(
        (r) => r.querySelector('td')?.textContent,
      );

    // default: space desc (busiest on top)
    expect(mountOrder()).toEqual(['/data', '/', '/var']);
    expect(screen.getByTestId('soul-disk-th-space').textContent).toContain('▼');

    // click Mount → alphabetical asc + caret moves to Mount
    await user.click(screen.getByTestId('soul-disk-th-mount'));
    expect(mountOrder()).toEqual(['/', '/data', '/var']);
    expect(screen.getByTestId('soul-disk-th-mount').textContent).toContain('▲');
    expect(screen.getByTestId('soul-disk-th-space').textContent).not.toContain('▼');

    // click Space → natural desc, then click again → toggle asc
    await user.click(screen.getByTestId('soul-disk-th-space'));
    expect(mountOrder()).toEqual(['/data', '/', '/var']);
    await user.click(screen.getByTestId('soul-disk-th-space'));
    expect(mountOrder()).toEqual(['/var', '/', '/data']);
    expect(screen.getByTestId('soul-disk-th-space').textContent).toContain('▲');
    expect(screen.getByTestId('soul-disk-th-space')).toHaveAttribute('aria-sort', 'ascending');
  });

  it('UtilTrend hover shows the nearest sample timestamp + value, hides on leave', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/souls/host04.example.com/telemetry',
        body: {
          sid: 'host04.example.com',
          stale: false,
          collected_at: '2026-05-26T09:59:50Z',
          latest: {
            cpu_pct: 42, load1: 1, load5: 1, load15: 1,
            mem_used_mb: 8000, mem_total_mb: 16000, swap_used_mb: 0, uptime_sec: 100,
            net_rx_bps: 0, net_tx_bps: 0, net_err_ps: 0, interval_sec: 15, disks: [],
          },
          window: [
            { collected_at: '2026-05-26T09:59:50Z', cpu_pct: 42, load1: 1, mem_used_mb: 8000, mem_total_mb: 16000, net_rx_bps: 0, net_tx_bps: 0 },
            { collected_at: '2026-05-26T09:59:35Z', cpu_pct: 30, load1: 1, mem_used_mb: 7000, mem_total_mb: 16000, net_rx_bps: 0, net_tx_bps: 0 },
          ],
        },
      },
      soulRoute('host04.example.com'),
    ]);
    renderAt('host04.example.com');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'host04.example.com' })).toBeInTheDocument();
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Utilization' }));
    await waitFor(() => expect(screen.getByTestId('soul-trend-cpu')).toBeInTheDocument());

    const svg = within(screen.getByTestId('soul-trend-cpu')).getByRole('img');
    fireEvent.mouseMove(svg, { clientX: 10 });
    // jsdom rect is zero-sized → snaps to sample 0 (chronological oldest = 09:59:35, cpu 30%)
    const tip = await screen.findByTestId('soul-trend-tooltip');
    expect(tip).toHaveTextContent('09:59:35');
    expect(tip).toHaveTextContent('30%');

    fireEvent.mouseLeave(svg);
    await waitFor(() => expect(screen.queryByTestId('soul-trend-tooltip')).toBeNull());
  });

  it('graceful no-data when latest is absent', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/souls/host02.example.com/telemetry',
        body: { sid: 'host02.example.com', stale: true },
      },
      soulRoute('host02.example.com'),
    ]);
    renderAt('host02.example.com');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'host02.example.com' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Utilization' }));

    await waitFor(() => {
      expect(screen.getByTestId('soul-util-nodata')).toBeInTheDocument();
    });
  });
});
