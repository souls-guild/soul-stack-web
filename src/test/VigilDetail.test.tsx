import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { VigilDetail } from '../pages/beacons/VigilDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const SAMPLE = {
  name: 'redis-down',
  check: 'core.beacon.service_down',
  interval: '30s',
  params: { service: 'redis' },
  enabled: true,
  sid: 'host01.example.com',
  created_by_aid: 'archon-alice',
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
};

describe('VigilDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит детали Vigil-а из /v1/vigils/{name}', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/vigils/redis-down', body: SAMPLE },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/vigils/:name" element={<VigilDetail />} />
      </Routes>,
      '/vigils/redis-down',
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /redis-down/ })).toBeInTheDocument();
    });
    expect(screen.getAllByText('core.beacon.service_down').length).toBeGreaterThan(0);
    expect(screen.getByText(/sid: host01\.example\.com/)).toBeInTheDocument();
    expect(screen.getAllByText(/archon-alice/).length).toBeGreaterThan(0);
    // Portent history placeholder
    expect(screen.getByText(/Portent history/i)).toBeInTheDocument();
  });
});
