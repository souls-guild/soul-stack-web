import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from './renderWithProviders';
import { SoulsList } from '../pages/souls/SoulsList';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

describe('SoulsList', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит список Souls из /v1/souls', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/souls',
        body: {
          items: [
            {
              sid: 'host01.example.com',
              transport: 'agent',
              status: 'connected',
              covens: ['prod', 'redis-prod'],
              last_seen_at: new Date(Date.now() - 30_000).toISOString(),
              last_seen_by_kid: 'keeper-01',
              registered_at: '2026-05-01T00:00:00Z',
            },
          ],
          offset: 0,
          limit: 200,
          total: 1,
        },
      },
    ]);
    renderWithProviders(<SoulsList />, '/souls');
    expect(screen.getByRole('heading', { name: /Souls/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('host01.example.com')).toBeInTheDocument();
    });
    // 'connected' встречается и в <option> select-фильтра, и в Badge —
    // поэтому матчим все вхождения и убеждаемся, что Badge отрендерился.
    expect(screen.getAllByText('connected').length).toBeGreaterThanOrEqual(2);
  });
});
