import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { IncarnationDetail } from '../pages/incarnations/IncarnationDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

describe('IncarnationDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит detail incarnation-а', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations/redis-prod',
        body: {
          name: 'redis-prod',
          service: 'redis',
          service_version: 'v2.0.0',
          state_schema_version: 3,
          covens: ['prod'],
          spec: { replicas: 3 },
          state: { primary: 'host01.example.com', replicas: ['host02.example.com'] },
          status: 'ready',
          created_by_aid: 'archon-alice',
          created_at: '2026-05-20T10:00:00Z',
          updated_at: '2026-05-25T12:00:00Z',
          last_drift_check_at: '2026-05-25T11:30:00Z',
        },
      },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/redis-prod',
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'redis-prod' })).toBeInTheDocument();
    });
    expect(screen.getByText(/incarnation\.state/i)).toBeInTheDocument();
  });
});
