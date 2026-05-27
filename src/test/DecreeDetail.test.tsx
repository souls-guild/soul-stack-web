import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { DecreeDetail } from '../pages/beacons/DecreeDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const SAMPLE = {
  name: 'restart-on-config',
  on_beacon: 'redis-config-changed',
  where: 'portent.kind == "core.beacon.file_changed" && portent.path == "/etc/redis.conf"',
  coven: ['prod'],
  incarnation_name: 'redis-prod',
  action_scenario: 'restart',
  action_input: { force: true },
  cooldown: '1m',
  enabled: true,
  created_by_aid: 'archon-alice',
  created_at: '2026-05-10T00:00:00Z',
  updated_at: '2026-05-10T00:00:00Z',
};

describe('DecreeDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит детали Decree-а из /v1/decrees/{name}', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/decrees/restart-on-config', body: SAMPLE },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/decrees/:name" element={<DecreeDetail />} />
      </Routes>,
      '/decrees/restart-on-config',
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /restart-on-config/ })).toBeInTheDocument();
    });
    // CEL where отображается в monospace pre-блоке
    expect(screen.getByText(/portent\.kind == "core\.beacon\.file_changed"/)).toBeInTheDocument();
    // action scenario / incarnation в meta
    expect(screen.getByText('restart')).toBeInTheDocument();
    expect(screen.getByText('redis-prod')).toBeInTheDocument();
    // Recent fires placeholder
    expect(screen.getByText(/Recent fires/i)).toBeInTheDocument();
  });
});
