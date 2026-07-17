import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installFetchMock } from './fetchMock';
import { renderWithProviders } from './renderWithProviders';
import { HostUtilizationPanel } from '../pages/incarnations/HostUtilizationPanel';

const AGG = '/v1/incarnations/redis-prod/telemetry';
const SOUL = '/v1/souls/h1.example.com/telemetry';

const LATEST = {
  cpu_pct: 42.3,
  load1: 1.2,
  load5: 0.9,
  load15: 0.7,
  mem_used_mb: 3200,
  mem_total_mb: 8000,
  swap_used_mb: 0,
  uptime_sec: 100000,
  disks: [{ mount: '/', used_mb: 5000, total_mb: 10000 }],
};

function render() {
  renderWithProviders(<HostUtilizationPanel incarnationName="redis-prod" />);
}

describe('HostUtilizationPanel', () => {
  it('happy: latest → CPU/mem/disk/load/uptime + freshness', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: AGG,
        body: {
          incarnation: 'redis-prod',
          truncated: false,
          hosts: [
            { sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST },
          ],
        },
      },
    ]);
    render();
    await waitFor(() => expect(screen.getByText('42%')).toBeInTheDocument());
    expect(screen.getByText('3.1 GB / 7.8 GB')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument(); // busiest disk 5000/10000
    expect(screen.getByText('1.20')).toBeInTheDocument(); // load1
    expect(screen.getByText('1d 3h')).toBeInTheDocument(); // uptime 100000s
    expect(screen.getByTestId('freshness-fresh')).toBeInTheDocument();
    expect(screen.queryByTestId('freshness-stale')).not.toBeInTheDocument();
  });

  it('TTL expired: stale=true → "stale", not shown as fresh', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: AGG,
        body: {
          incarnation: 'redis-prod',
          truncated: false,
          hosts: [
            { sid: 'h1.example.com', stale: true, collected_at: '2026-05-26T09:00:00Z', latest: LATEST },
          ],
        },
      },
    ]);
    render();
    await waitFor(() => expect(screen.getByTestId('freshness-stale')).toBeInTheDocument());
    expect(screen.getByText('stale')).toBeInTheDocument();
    expect(screen.queryByTestId('freshness-fresh')).not.toBeInTheDocument();
  });

  it('no vitals (legacy agent): latest missing → graceful "no data", no crash', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: AGG,
        body: {
          incarnation: 'redis-prod',
          truncated: false,
          hosts: [{ sid: 'h1.example.com', stale: true }],
        },
      },
    ]);
    render();
    await waitFor(() => expect(screen.getByTestId('freshness-nodata')).toBeInTheDocument());
    expect(screen.getByText('no data')).toBeInTheDocument();
    // Table rendered, panel did not break.
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByTestId('freshness-fresh')).not.toBeInTheDocument();
  });

  it('empty souls: hosts=[] → empty-state', async () => {
    installFetchMock([
      { method: 'GET', url: AGG, body: { incarnation: 'redis-prod', truncated: false, hosts: [] } },
    ]);
    render();
    await waitFor(() => expect(screen.getByTestId('util-empty')).toBeInTheDocument());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('nullable array: hosts=null → empty-state, no crash', async () => {
    installFetchMock([
      { method: 'GET', url: AGG, body: { incarnation: 'redis-prod', truncated: false, hosts: null } },
    ]);
    render();
    await waitFor(() => expect(screen.getByTestId('util-empty')).toBeInTheDocument());
  });

  it('403: insufficient permissions → graceful degrade, no table', async () => {
    installFetchMock([{ method: 'GET', url: AGG, status: 403, body: { title: 'forbidden', status: 403 } }]);
    render();
    await waitFor(() => expect(screen.getByTestId('util-forbidden')).toBeInTheDocument());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('404 (old Keeper without telemetry): soft "unavailable", not an error-box', async () => {
    installFetchMock([{ method: 'GET', url: AGG, status: 404, body: { title: 'not found', status: 404 } }]);
    render();
    await waitFor(() => expect(screen.getByTestId('util-unavailable')).toBeInTheDocument());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(/Failed to load telemetry/)).not.toBeInTheDocument();
  });

  it('partial latest (no load): panel does not crash, load → "—"', async () => {
    const partial = {
      cpu_pct: 42.3,
      mem_used_mb: 3200,
      mem_total_mb: 8000,
      swap_used_mb: 0,
      uptime_sec: 100000,
      disks: [{ mount: '/', used_mb: 5000, total_mb: 10000 }],
    };
    installFetchMock([
      {
        method: 'GET',
        url: AGG,
        body: {
          incarnation: 'redis-prod',
          truncated: false,
          hosts: [{ sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: partial }],
        },
      },
    ]);
    render();
    await waitFor(() => expect(screen.getByText('42%')).toBeInTheDocument());
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0); // load cell degraded
  });

  it('expand host → sparklines from window (newest-first, expanded)', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: SOUL,
        body: {
          sid: 'h1.example.com',
          stale: false,
          collected_at: '2026-05-26T10:00:00Z',
          received_at: '2026-05-26T10:00:01Z',
          window: [
            { collected_at: '2026-05-26T10:00:00Z', cpu_pct: 60, load1: 1.5, mem_used_mb: 5000, mem_total_mb: 8000 },
            { collected_at: '2026-05-26T09:59:00Z', cpu_pct: 50, load1: 1.0, mem_used_mb: 4000, mem_total_mb: 8000 },
          ],
        },
      },
      {
        method: 'GET',
        url: AGG,
        body: {
          incarnation: 'redis-prod',
          truncated: false,
          hosts: [
            { sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST },
          ],
        },
      },
    ]);
    render();
    const btn = await screen.findByLabelText(/Show sparklines for host/);
    await userEvent.click(btn);
    const cpu = await screen.findByTestId('spark-cpu');
    expect(cpu).toBeInTheDocument();
    expect(cpu.getAttribute('data-points')).toBe('2');
    expect(screen.getByTestId('spark-mem')).toBeInTheDocument();
    expect(screen.getByTestId('spark-load')).toBeInTheDocument();
  });

  it('expand: window=null → "window empty", no crash', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: SOUL,
        body: { sid: 'h1.example.com', stale: false, window: null },
      },
      {
        method: 'GET',
        url: AGG,
        body: {
          incarnation: 'redis-prod',
          truncated: false,
          hosts: [
            { sid: 'h1.example.com', stale: false, collected_at: '2026-05-26T10:00:00Z', latest: LATEST },
          ],
        },
      },
    ]);
    render();
    const btn = await screen.findByLabelText(/Show sparklines for host/);
    await userEvent.click(btn);
    expect(await screen.findByTestId('spark-empty')).toBeInTheDocument();
  });
});
