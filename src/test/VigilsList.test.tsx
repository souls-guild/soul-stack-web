import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { VigilsList } from '../pages/beacons/VigilsList';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const SAMPLE = {
  items: [
    {
      name: 'redis-down',
      check: 'core.beacon.service_down',
      interval: '30s',
      params: { service: 'redis' },
      enabled: true,
      sid: 'host01.example.com',
      created_at: '2026-05-01T00:00:00Z',
      updated_at: '2026-05-01T00:00:00Z',
    },
    {
      name: 'config-changed',
      check: 'core.beacon.file_changed',
      interval: '15s',
      params: { path: '/etc/redis.conf', recursive: false },
      enabled: false,
      coven: ['prod', 'redis-master'],
      created_at: '2026-05-02T00:00:00Z',
      updated_at: '2026-05-02T00:00:00Z',
    },
  ],
  offset: 0,
  limit: 50,
  total: 2,
};

describe('VigilsList', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит таблицу из /v1/vigils', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/vigils', body: SAMPLE }]);
    renderWithProviders(<VigilsList />, '/vigils');
    expect(screen.getByRole('heading', { name: /Vigils/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('redis-down')).toBeInTheDocument();
      expect(screen.getByText('config-changed')).toBeInTheDocument();
    });
    // subject renders: sid for the first one, coven for the second.
    expect(screen.getByText('host01.example.com')).toBeInTheDocument();
    expect(screen.getByText('prod, redis-master')).toBeInTheDocument();
  });

  it('фильтр "enabled only" скрывает disabled Vigils', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/vigils', body: SAMPLE }]);
    renderWithProviders(<VigilsList />, '/vigils');
    await waitFor(() => expect(screen.getByText('config-changed')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/enabled-only/i));
    expect(screen.queryByText('config-changed')).not.toBeInTheDocument();
    expect(screen.getByText('redis-down')).toBeInTheDocument();
  });

  it('фильтр по beacon kind — exact match', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/vigils', body: SAMPLE }]);
    renderWithProviders(<VigilsList />, '/vigils');
    await waitFor(() => expect(screen.getByText('redis-down')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByRole('combobox'),
      'core.beacon.file_changed',
    );
    expect(screen.queryByText('redis-down')).not.toBeInTheDocument();
    expect(screen.getByText('config-changed')).toBeInTheDocument();
  });
});
