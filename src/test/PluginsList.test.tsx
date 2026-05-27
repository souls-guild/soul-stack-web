import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { PluginsList } from '../pages/plugins/PluginsList';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const SAMPLE = {
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
    {
      namespace: 'cloud',
      name: 'soul-cloud-aws',
      ref: 'v0.3.1',
      sha256: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      allowed_by_aid: 'archon-bob',
      allowed_at: '2026-04-20T00:00:00Z',
      revoked_at: '2026-05-05T00:00:00Z',
    },
  ],
};

describe('PluginsList', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит таблицу из /v1/plugins/sigils', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: SAMPLE }]);
    renderWithProviders(<PluginsList />, '/plugins');
    expect(screen.getByRole('heading', { name: /Plugins/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('soul-mod-acme')).toBeInTheDocument();
      expect(screen.getByText('soul-cloud-aws')).toBeInTheDocument();
    });
    // SHA-256 показывается префиксом, не полным значением.
    expect(screen.getByTitle(SAMPLE.items[0].sha256)).toBeInTheDocument();
  });

  it('namespace-чип сужает выдачу', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: SAMPLE }]);
    renderWithProviders(<PluginsList />, '/plugins');
    await waitFor(() => expect(screen.getByText('soul-mod-acme')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'cloud', pressed: false }));
    expect(screen.queryByText('soul-mod-acme')).not.toBeInTheDocument();
    expect(screen.getByText('soul-cloud-aws')).toBeInTheDocument();
  });

  it('status select фильтрует active vs revoked', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: SAMPLE }]);
    renderWithProviders(<PluginsList />, '/plugins');
    await waitFor(() => expect(screen.getByText('soul-mod-acme')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/Status/i), 'revoked');
    expect(screen.queryByText('soul-mod-acme')).not.toBeInTheDocument();
    expect(screen.getByText('soul-cloud-aws')).toBeInTheDocument();
  });

  it('search по name — case-insensitive contains', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: SAMPLE }]);
    renderWithProviders(<PluginsList />, '/plugins');
    await waitFor(() => expect(screen.getByText('soul-mod-acme')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/soul-mod-acme/i), 'AWS');
    expect(screen.queryByText('soul-mod-acme')).not.toBeInTheDocument();
    expect(screen.getByText('soul-cloud-aws')).toBeInTheDocument();
  });
});
