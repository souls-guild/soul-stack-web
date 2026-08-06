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
  subject: { coven: ['prod'] },
  incarnation_name: 'redis-prod',
  action_scenario: 'restart',
  action_input: { force: true },
  cooldown: '1m',
  enabled: true,
  created_by_aid: 'archon-alice',
  created_at: '2026-05-10T00:00:00Z',
  updated_at: '2026-05-10T00:00:00Z',
};

const SAMPLE_NO_AID = {
  ...SAMPLE,
  created_by_aid: null,
};

describe('DecreeDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('renders Decree details from /v1/decrees/{name}', async () => {
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
    // CEL where is displayed in a monospace pre-block
    expect(screen.getByText(/portent\.kind == "core\.beacon\.file_changed"/)).toBeInTheDocument();
    // action scenario / incarnation in meta
    expect(screen.getByText('restart')).toBeInTheDocument();
    expect(screen.getByText('redis-prod')).toBeInTheDocument();
    // the subject is the Decree's own selector, not the target incarnation
    expect(screen.getByText('coven=prod')).toBeInTheDocument();
    // Recent fires placeholder
    expect(screen.getByText(/Recent fires/i)).toBeInTheDocument();
  });

  // -- Guard tests: clickable links --------------------------------------------

  it('[LINKS] created_by_aid renders as a link to /archons/:aid', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/decrees/restart-on-config', body: SAMPLE },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/decrees/:name" element={<DecreeDetail />} />
      </Routes>,
      '/decrees/restart-on-config',
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: /restart-on-config/ })).toBeInTheDocument());

    const link = screen.getByRole('link', { name: 'archon-alice' });
    expect(link).toHaveAttribute('href', '/archons/archon-alice');
  });

  it('[LINKS] shows «—» when created_by_aid is absent, no archon links', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/decrees/restart-on-config', body: SAMPLE_NO_AID },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/decrees/:name" element={<DecreeDetail />} />
      </Routes>,
      '/decrees/restart-on-config',
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: /restart-on-config/ })).toBeInTheDocument());

    expect(screen.queryByRole('link', { name: /archon-/i })).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
