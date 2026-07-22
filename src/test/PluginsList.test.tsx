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

  it('404 from /v1/plugins/sigils → "Sigil not enabled" without crash', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/plugins/sigils', status: 404, body: { title: 'not found', detail: 'no such endpoint' } },
    ]);
    renderWithProviders(<PluginsList />, '/plugins');
    await waitFor(() => {
      expect(screen.getByText(/Sigil/i)).toBeInTheDocument();
    });
    // Make sure it is not a raw error, but a friendly message
    expect(screen.queryByText(/HTTP 404/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no such endpoint/i)).not.toBeInTheDocument();
  });

  it('500 from /v1/plugins/sigils → regular error handling (not "not enabled")', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/plugins/sigils', status: 500, body: { title: 'internal error', detail: 'db down' } },
    ]);
    renderWithProviders(<PluginsList />, '/plugins');
    await waitFor(() => {
      expect(screen.getByText(/500/)).toBeInTheDocument();
    });
    // Does not show "not enabled" on 500
    expect(screen.queryByText(/pluginSigilDisabledTitle/i)).not.toBeInTheDocument();
  });

  it('renders table from /v1/plugins/sigils', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: SAMPLE }]);
    renderWithProviders(<PluginsList />, '/plugins');
    expect(screen.getByRole('heading', { name: /Plugins/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('soul-mod-acme')).toBeInTheDocument();
      expect(screen.getByText('soul-cloud-aws')).toBeInTheDocument();
    });
    // SHA-256 is shown as a prefix, not the full value.
    expect(screen.getByTitle(SAMPLE.items[0].sha256)).toBeInTheDocument();
  });

  it('namespace chip narrows the results', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: SAMPLE }]);
    renderWithProviders(<PluginsList />, '/plugins');
    await waitFor(() => expect(screen.getByText('soul-mod-acme')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'cloud', pressed: false }));
    expect(screen.queryByText('soul-mod-acme')).not.toBeInTheDocument();
    expect(screen.getByText('soul-cloud-aws')).toBeInTheDocument();
  });

  it('status select filters active vs revoked', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: SAMPLE }]);
    renderWithProviders(<PluginsList />, '/plugins');
    await waitFor(() => expect(screen.getByText('soul-mod-acme')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/Status/i), 'revoked');
    expect(screen.queryByText('soul-mod-acme')).not.toBeInTheDocument();
    expect(screen.getByText('soul-cloud-aws')).toBeInTheDocument();
  });

  it('search by name — case-insensitive contains', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: SAMPLE }]);
    renderWithProviders(<PluginsList />, '/plugins');
    await waitFor(() => expect(screen.getByText('soul-mod-acme')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/soul-mod-acme/i), 'AWS');
    expect(screen.queryByText('soul-mod-acme')).not.toBeInTheDocument();
    expect(screen.getByText('soul-cloud-aws')).toBeInTheDocument();
  });

  // -- Guard tests: clickable links --------------------------------------

  it('[LINKS] allowed_by_aid renders as a link to /archons/:aid', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: SAMPLE }]);
    renderWithProviders(<PluginsList />, '/plugins');

    await waitFor(() => expect(screen.getByText('soul-mod-acme')).toBeInTheDocument());

    // archon-alice allowed soul-mod-acme
    const linkAlice = screen.getByRole('link', { name: 'archon-alice' });
    expect(linkAlice).toHaveAttribute('href', '/archons/archon-alice');

    // archon-bob allowed soul-cloud-aws
    const linkBob = screen.getByRole('link', { name: 'archon-bob' });
    expect(linkBob).toHaveAttribute('href', '/archons/archon-bob');
  });

  it('[LINKS] allowed_by_aid with special characters is URL-encoded correctly', async () => {
    const specialSample = {
      items: [
        {
          namespace: 'mod',
          name: 'soul-mod-test',
          ref: 'v1.0.0',
          sha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
          allowed_by_aid: 'archon-special+one',
          allowed_at: '2026-05-01T00:00:00Z',
          revoked_at: null,
        },
      ],
    };
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: specialSample }]);
    renderWithProviders(<PluginsList />, '/plugins');

    await waitFor(() => expect(screen.getByText('soul-mod-test')).toBeInTheDocument());

    const link = screen.getByRole('link', { name: 'archon-special+one' });
    expect(link).toHaveAttribute('href', `/archons/${encodeURIComponent('archon-special+one')}`);
  });

  it('[LINKS] no archon links when the list is empty', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: { items: [] } }]);
    renderWithProviders(<PluginsList />, '/plugins');

    await waitFor(() => expect(screen.getByText(/keeper\.plugin\.allow/i)).toBeInTheDocument());

    expect(screen.queryByRole('link', { name: /archon-/i })).not.toBeInTheDocument();
  });
});
