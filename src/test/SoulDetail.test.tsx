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
