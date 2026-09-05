import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { PluginDetail } from '../pages/plugins/PluginDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const ACTIVE = {
  items: [
    {
      namespace: 'mod',
      name: 'soul-mod-acme',
      ref: 'v1.0.0',
      sha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      allowed_by_aid: 'archon-alice',
      allowed_at: '2026-05-01T00:00:00Z',
      revoked_at: null,
    },
  ],
};

const AUDIT = {
  items: [
    {
      id: '01J0AUDIT0001',
      type: 'plugin.allowed',
      source: 'api',
      archon_aid: 'archon-alice',
      correlation_id: null,
      created_at: '2026-05-01T00:00:00Z',
      payload: {
        namespace: 'mod',
        name: 'soul-mod-acme',
        ref: 'v1.0.0',
        sha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      },
    },
    {
      // Not our ref - should be filtered out.
      id: '01J0AUDIT0002',
      type: 'plugin.allowed',
      source: 'api',
      archon_aid: 'archon-alice',
      correlation_id: null,
      created_at: '2026-05-02T00:00:00Z',
      payload: {
        namespace: 'mod',
        name: 'other-mod',
        ref: 'v0.1.0',
      },
    },
  ],
  offset: 0,
  limit: 200,
  total: 2,
};

describe('PluginDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
    // confirm/alert default to true for revoke-action tests.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders meta + sha256 from list lookup', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: ACTIVE }]);
    renderWithProviders(
      <Routes>
        <Route path="/plugins/:namespace/:name/:ref" element={<PluginDetail />} />
      </Routes>,
      '/plugins/mod/soul-mod-acme/v1.0.0',
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'soul-mod-acme' })).toBeInTheDocument();
    });
    // Namespace 'mod' appears in several places (header badge + meta + chip).
    expect(screen.getAllByText('mod').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('@v1.0.0')).toBeInTheDocument();
    // sha256 is present as full value (in the overview block).
    expect(screen.getByText(ACTIVE.items[0].sha256)).toBeInTheDocument();
  });

  it('empty state when no record exists', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: { items: [] } }]);
    renderWithProviders(
      <Routes>
        <Route path="/plugins/:namespace/:name/:ref" element={<PluginDetail />} />
      </Routes>,
      '/plugins/mod/unknown/v9.9.9',
    );
    await waitFor(() => {
      expect(screen.getByText(/No active Sigil grant/i)).toBeInTheDocument();
    });
  });

  it('Audit tab filters events by (ns, name, ref) from payload', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/plugins/sigils', body: ACTIVE },
      { method: 'GET', url: '/v1/audit', body: AUDIT },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/plugins/:namespace/:name/:ref" element={<PluginDetail />} />
      </Routes>,
      '/plugins/mod/soul-mod-acme/v1.0.0',
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'soul-mod-acme' })).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Audit history/i }));
    await waitFor(() => {
      expect(screen.getByText('plugin.allowed')).toBeInTheDocument();
    });
    // other-mod in payload - must NOT be matched.
    expect(screen.queryByText('other-mod')).not.toBeInTheDocument();
  });

  it('Plugin kinds tab shows namespace reference', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: ACTIVE }]);
    renderWithProviders(
      <Routes>
        <Route path="/plugins/:namespace/:name/:ref" element={<PluginDetail />} />
      </Routes>,
      '/plugins/mod/soul-mod-acme/v1.0.0',
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'soul-mod-acme' })).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Plugin kinds/i }));
    expect(screen.getByText(/soul_module/i)).toBeInTheDocument();
    expect(screen.getByText(/ssh_provider/i)).toBeInTheDocument();
    // NIM-761 removed the CloudDriver contract — the kinds tab must not offer it.
    expect(screen.queryByText(/cloud_driver/i)).not.toBeInTheDocument();
  });
});
