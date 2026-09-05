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
      alias: 'acme',
      source: 'https://git.example.com/soul-mod-acme.git',
      ref: 'v1.0.0',
      kind: 'git',
      artifacts: [
        {
          os: 'linux',
          arch: 'amd64',
          path: 'soul-mod-acme_linux_amd64',
          sha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        },
      ],
      allowed_by_aid: 'archon-alice',
      allowed_at: '2026-05-01T00:00:00Z',
      revoked_at: null,
    },
    {
      alias: 'nexus-tool',
      source: 'https://nexus.example.com/soul-mod-nexus-tool/',
      ref: 'v0.3.1',
      kind: 'artifact',
      artifacts: [
        {
          os: 'linux',
          arch: 'arm64',
          path: 'soul-mod-nexus-tool_linux_arm64',
          sha256: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
        },
      ],
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
      expect(screen.getByText('acme')).toBeInTheDocument();
      expect(screen.getByText('nexus-tool')).toBeInTheDocument();
    });
    // The list shows how many artifacts the release published; the digests
    // themselves live on the detail page, one per platform.
    expect(screen.getByText(SAMPLE.items[0].source)).toBeInTheDocument();
  });

  it('kind chip narrows the results', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: SAMPLE }]);
    renderWithProviders(<PluginsList />, '/plugins');
    await waitFor(() => expect(screen.getByText('acme')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'artifact', pressed: false }));
    expect(screen.queryByText('acme')).not.toBeInTheDocument();
    expect(screen.getByText('nexus-tool')).toBeInTheDocument();
  });

  it('status select filters active vs revoked', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: SAMPLE }]);
    renderWithProviders(<PluginsList />, '/plugins');
    await waitFor(() => expect(screen.getByText('acme')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/Status/i), 'revoked');
    expect(screen.queryByText('acme')).not.toBeInTheDocument();
    expect(screen.getByText('nexus-tool')).toBeInTheDocument();
  });

  it('search matches the alias — case-insensitive contains', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: SAMPLE }]);
    renderWithProviders(<PluginsList />, '/plugins');
    await waitFor(() => expect(screen.getByText('acme')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/acme/i), 'NEXUS');
    expect(screen.queryByText('acme')).not.toBeInTheDocument();
    expect(screen.getByText('nexus-tool')).toBeInTheDocument();
  });

  it('search also matches the source, not only the alias', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: SAMPLE }]);
    renderWithProviders(<PluginsList />, '/plugins');
    await waitFor(() => expect(screen.getByText('acme')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/acme/i), 'nexus.example.com');
    expect(screen.queryByText('acme')).not.toBeInTheDocument();
    expect(screen.getByText('nexus-tool')).toBeInTheDocument();
  });

  // -- Guard tests: clickable links --------------------------------------

  it('[LINKS] allowed_by_aid renders as a link to /archons/:aid', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: SAMPLE }]);
    renderWithProviders(<PluginsList />, '/plugins');

    await waitFor(() => expect(screen.getByText('acme')).toBeInTheDocument());

    // archon-alice allowed acme
    const linkAlice = screen.getByRole('link', { name: 'archon-alice' });
    expect(linkAlice).toHaveAttribute('href', '/archons/archon-alice');

    // archon-bob allowed nexus-tool
    const linkBob = screen.getByRole('link', { name: 'archon-bob' });
    expect(linkBob).toHaveAttribute('href', '/archons/archon-bob');
  });

  it('[LINKS] allowed_by_aid with special characters is URL-encoded correctly', async () => {
    const specialSample = {
      items: [
        {
          alias: 'test',
          source: 'https://git.example.com/soul-mod-test.git',
          ref: 'v1.0.0',
          kind: 'git',
          artifacts: [],
          allowed_by_aid: 'archon-special+one',
          allowed_at: '2026-05-01T00:00:00Z',
          revoked_at: null,
        },
      ],
    };
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: specialSample }]);
    renderWithProviders(<PluginsList />, '/plugins');

    await waitFor(() => expect(screen.getByText('test')).toBeInTheDocument());

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
