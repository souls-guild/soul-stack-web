import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { SoulDetail } from '../pages/souls/SoulDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

function renderAt(sid: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/souls/:sid" element={<SoulDetail />} />
    </Routes>,
    `/souls/${sid}`,
  );
}

describe('SoulDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит overview-вкладку с данными Soul', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/souls/host01.example.com',
        body: {
          sid: 'host01.example.com',
          transport: 'agent',
          status: 'connected',
          covens: ['prod', 'redis-prod'],
          last_seen_at: '2026-05-26T10:00:00Z',
          last_seen_by_kid: 'keeper-01',
          registered_at: '2026-05-01T00:00:00Z',
        },
      },
    ]);
    renderAt('host01.example.com');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'host01.example.com' })).toBeInTheDocument();
    });
    expect(screen.getByText('prod, redis-prod')).toBeInTheDocument();
  });

  it('Soulprint-вкладка рендерит typed_facts.os.family', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/souls/host01.example.com/soulprint',
        body: {
          sid: 'host01.example.com',
          typed_facts: {
            sid: 'host01.example.com',
            hostname: 'host01',
            os: {
              family: 'debian',
              distro: 'ubuntu',
              version: '22.04',
              codename: 'jammy',
              arch: 'amd64',
              pkg_mgr: 'apt',
              init_system: 'systemd',
            },
            kernel: { version: '5.15.0-101-generic', release: '5.15.0' },
            cpu: { count: 8, model: 'Xeon', vendor: 'Intel' },
            memory: { total_mb: 16000, available_mb: 12000, swap_mb: 4096 },
            network: {
              primary_ip: '10.0.0.10',
              fqdn: 'host01.example.com',
              interfaces: [{ name: 'eth0', ipv4: ['10.0.0.10/24'], mac: 'aa:bb:cc:dd:ee:ff', mtu: 1500 }],
            },
          },
          collected_at: '2026-05-26T09:59:00Z',
          received_at: '2026-05-26T10:00:00Z',
        },
      },
      {
        method: 'GET',
        url: '/v1/souls/host01.example.com',
        body: {
          sid: 'host01.example.com',
          transport: 'agent',
          status: 'connected',
          covens: ['prod'],
          registered_at: '2026-05-01T00:00:00Z',
        },
      },
    ]);
    renderAt('host01.example.com');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'host01.example.com' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Soulprint' }));

    await waitFor(() => {
      expect(screen.getByText('debian')).toBeInTheDocument();
    });
    expect(screen.getByText('ubuntu')).toBeInTheDocument();
    expect(screen.getByText('systemd')).toBeInTheDocument();
    expect(screen.getByText('apt')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.10')).toBeInTheDocument();
  });

  it('History-вкладка: рендерит timeline + корректный link-routing', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/souls/host01.example.com/history',
        body: {
          sid: 'host01.example.com',
          items: [
            {
              type: 'scenario',
              id: 'apply-tide-1',
              incarnation: 'redis-prod',
              scenario: 'add_user',
              status: 'succeeded',
              started_at: '2026-05-27T10:00:00Z',
              finished_at: '2026-05-27T10:01:00Z',
              tide_id: 'tide-abc',
            },
            {
              type: 'scenario',
              id: 'apply-plain-2',
              incarnation: 'redis-prod',
              scenario: 'restart',
              status: 'succeeded',
              started_at: '2026-05-27T09:00:00Z',
              finished_at: '2026-05-27T09:00:30Z',
            },
            {
              type: 'errand',
              id: 'errand-9',
              module: 'core.cmd.shell',
              status: 'failed',
              started_at: '2026-05-27T08:00:00Z',
              finished_at: '2026-05-27T08:00:05Z',
              errand_run_id: 'erun-xyz',
            },
          ],
          offset: 0,
          limit: 50,
          total: 3,
        },
      },
      {
        method: 'GET',
        url: '/v1/souls/host01.example.com',
        body: {
          sid: 'host01.example.com',
          transport: 'agent',
          status: 'connected',
          covens: ['prod'],
          registered_at: '2026-05-01T00:00:00Z',
        },
      },
    ]);
    renderAt('host01.example.com');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'host01.example.com' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'History' }));

    await waitFor(() => {
      expect(screen.getByTestId('soul-history-table')).toBeInTheDocument();
    });

    // scenario с tide_id — роут /tides/:id удалён, fallback → /incarnations/:incarnation
    const tideLink = screen.getByRole('link', { name: 'apply-tide-1' });
    expect(tideLink).toHaveAttribute('href', '/incarnations/redis-prod');
    // scenario без tide_id → /incarnations/:incarnation
    const incLink = screen.getByRole('link', { name: 'apply-plain-2' });
    expect(incLink).toHaveAttribute('href', '/incarnations/redis-prod');
    // errand с errand_run_id — роут /errand-runs/:id удалён, plain span (не ссылка)
    expect(screen.queryByRole('link', { name: 'errand-9' })).toBeNull();
    expect(screen.getByText('errand-9')).toBeInTheDocument();
    // module errand-записи виден
    expect(screen.getByText('core.cmd.shell')).toBeInTheDocument();
  });

  it('History-вкладка: фильтр по type зовёт endpoint с ?type=errand', async () => {
    let lastUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/history')) {
        lastUrl = url;
        return new Response(
          JSON.stringify({ sid: 'h.example.com', items: [], offset: 0, limit: 50, total: 0 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          sid: 'h.example.com',
          transport: 'agent',
          status: 'connected',
          covens: [],
          registered_at: '2026-05-01T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    renderAt('h.example.com');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'h.example.com' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'History' }));
    await waitFor(() => {
      expect(screen.getByTestId('history-filter-errand')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('history-filter-errand'));
    await waitFor(() => {
      expect(lastUrl).toContain('type=errand');
    });
    expect(lastUrl).not.toContain('type=scenario');
  });

  it('History-вкладка: empty-state «Нет операций с этим хостом»', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/souls/empty.example.com/history',
        body: { sid: 'empty.example.com', items: [], offset: 0, limit: 50, total: 0 },
      },
      {
        method: 'GET',
        url: '/v1/souls/empty.example.com',
        body: {
          sid: 'empty.example.com',
          transport: 'agent',
          status: 'connected',
          covens: [],
          registered_at: '2026-05-01T00:00:00Z',
        },
      },
    ]);
    renderAt('empty.example.com');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'empty.example.com' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'History' }));
    await waitFor(() => {
      expect(screen.getByText(/Нет операций с этим хостом/)).toBeInTheDocument();
    });
  });

  it('410 → graceful «soulprint ещё не получен»', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/souls/host02.example.com/soulprint',
        status: 410,
        body: { type: 'about:blank', title: 'soulprint-not-received', detail: 'no facts yet' },
      },
      {
        method: 'GET',
        url: '/v1/souls/host02.example.com',
        body: {
          sid: 'host02.example.com',
          transport: 'ssh',
          status: 'connected',
          covens: [],
          registered_at: '2026-05-01T00:00:00Z',
        },
      },
    ]);
    renderAt('host02.example.com');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'host02.example.com' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Soulprint' }));

    await waitFor(() => {
      expect(screen.getByText(/ещё не получен от Soul/i)).toBeInTheDocument();
    });
  });
});
