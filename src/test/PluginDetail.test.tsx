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
      type: 'plugin.sigil.allowed',
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
      // Не наш ref — должен отфильтроваться.
      id: '01J0AUDIT0002',
      type: 'plugin.sigil.allowed',
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
    // confirm/alert по умолчанию true для тестов revoke-action.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('рендерит meta + sha256 из list lookup-а', async () => {
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
    // Namespace 'mod' появляется в нескольких местах (header badge + meta + chip).
    expect(screen.getAllByText('mod').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('@v1.0.0')).toBeInTheDocument();
    // sha256 присутствует полным значением (в overview-блоке).
    expect(screen.getByText(ACTIVE.items[0].sha256)).toBeInTheDocument();
  });

  it('пустой state когда записи нет', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: { items: [] } }]);
    renderWithProviders(
      <Routes>
        <Route path="/plugins/:namespace/:name/:ref" element={<PluginDetail />} />
      </Routes>,
      '/plugins/mod/unknown/v9.9.9',
    );
    await waitFor(() => {
      expect(screen.getByText(/Активного Sigil-допуска/i)).toBeInTheDocument();
    });
  });

  it('Audit-таб фильтрует events по (ns, name, ref) из payload', async () => {
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
      expect(screen.getByText('plugin.sigil.allowed')).toBeInTheDocument();
    });
    // other-mod в payload — НЕ должен попадать в матч.
    expect(screen.queryByText('other-mod')).not.toBeInTheDocument();
  });

  it('Plugin kinds tab показывает справку по namespace-ам', async () => {
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
    expect(screen.getByText(/cloud_driver/i)).toBeInTheDocument();
    expect(screen.getByText(/ssh_provider/i)).toBeInTheDocument();
  });
});
