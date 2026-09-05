import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { ServicesList } from '../pages/services/ServicesList';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const SAMPLE = {
  items: [
    {
      id: 'redis',
      git: 'https://git.example.com/services/redis.git',
      ref: 'v2.0.0',
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-05-01T00:00:00Z',
    },
    {
      id: 'postgres',
      git: 'https://git.example.com/services/postgres.git',
      ref: 'main',
      refresh: '5m',
      created_at: '2026-04-10T00:00:00Z',
      updated_at: '2026-05-10T00:00:00Z',
    },
  ],
};

describe('ServicesList', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('renders the table from /v1/services', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/services', body: SAMPLE }]);
    renderWithProviders(<ServicesList />, '/services');
    expect(screen.getByRole('heading', { name: /Services/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('redis')).toBeInTheDocument();
      expect(screen.getByText('postgres')).toBeInTheDocument();
    });
  });

  it('name contains filter hides non-matching rows', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/services', body: SAMPLE }]);
    renderWithProviders(<ServicesList />, '/services');
    await waitFor(() => expect(screen.getByText('redis')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/redis \/ postgres/i), 'post');
    expect(screen.queryByText('redis')).not.toBeInTheDocument();
    expect(screen.getByText('postgres')).toBeInTheDocument();
  });

  it('ref equals filter — exact match', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/services', body: SAMPLE }]);
    renderWithProviders(<ServicesList />, '/services');
    await waitFor(() => expect(screen.getByText('redis')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/v2\.0\.0 \/ main/i), 'main');
    expect(screen.queryByText('redis')).not.toBeInTheDocument();
    expect(screen.getByText('postgres')).toBeInTheDocument();
  });
});
