import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from './renderWithProviders';
import { DecreesList } from '../pages/beacons/DecreesList';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const SAMPLE = {
  items: [
    {
      name: 'restart-on-config',
      on_beacon: 'redis-config-changed',
      where: 'portent.kind == "core.beacon.file_changed"',
      subject: { coven: ['prod'] },
      incarnation_name: 'redis-prod',
      action_scenario: 'restart',
      action_input: {},
      cooldown: '1m',
      enabled: true,
      created_at: '2026-05-10T00:00:00Z',
      updated_at: '2026-05-10T00:00:00Z',
    },
  ],
  offset: 0,
  limit: 50,
  total: 1,
};

describe('DecreesList', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('renders the table from /v1/decrees', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/decrees', body: SAMPLE }]);
    renderWithProviders(<DecreesList />, '/decrees');
    expect(screen.getByRole('heading', { name: /Decrees/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('restart-on-config')).toBeInTheDocument();
      expect(screen.getByText('coven=prod')).toBeInTheDocument();
    });
    expect(screen.getByText('redis-config-changed')).toBeInTheDocument();
    expect(screen.getByText('restart')).toBeInTheDocument();
    expect(screen.getByText('redis-prod')).toBeInTheDocument();
    expect(screen.getByText('1m')).toBeInTheDocument();
    expect(screen.getByText('enabled')).toBeInTheDocument();
  });

  it('shows empty-state when there are no records', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/decrees', body: { items: [], offset: 0, limit: 50, total: 0 } },
    ]);
    renderWithProviders(<DecreesList />, '/decrees');
    await waitFor(() => {
      expect(screen.getByText(/No Decrees/i)).toBeInTheDocument();
    });
  });
});
