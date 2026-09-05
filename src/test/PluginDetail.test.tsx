import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { PluginDetail } from '../pages/plugins/PluginDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const LINUX_AMD64_SHA = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
const DARWIN_ARM64_SHA = '1111111122222222333333334444444455555555666666667777777788888888';

const ACTIVE = {
  items: [
    {
      alias: 'acme',
      source: 'https://git.example.com/soul-mod-acme.git',
      ref: 'v1.0.0',
      kind: 'git',
      artifacts: [
        { os: 'linux', arch: 'amd64', path: 'soul-mod-acme_linux_amd64', sha256: LINUX_AMD64_SHA },
        { os: 'darwin', arch: 'arm64', path: 'soul-mod-acme_darwin_arm64', sha256: DARWIN_ARM64_SHA },
      ],
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
        alias: 'acme',
        source: 'https://git.example.com/soul-mod-acme.git',
        ref: 'v1.0.0',
        kind: 'git',
        artifact_sha256: [LINUX_AMD64_SHA],
      },
    },
    {
      // A different grant — must be filtered out.
      id: '01J0AUDIT0002',
      type: 'plugin.allowed',
      source: 'api',
      archon_aid: 'archon-alice',
      correlation_id: null,
      created_at: '2026-05-02T00:00:00Z',
      payload: {
        alias: 'other-mod',
        source: 'https://git.example.com/other-mod.git',
        ref: 'v0.1.0',
      },
    },
  ],
  offset: 0,
  limit: 200,
  total: 2,
};

function renderDetail(path: string) {
  renderWithProviders(
    <Routes>
      <Route path="/plugins/:alias" element={<PluginDetail />} />
    </Routes>,
    path,
  );
}

describe('PluginDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
    // confirm/alert default to true for revoke-action tests.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders meta from list lookup', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: ACTIVE }]);
    renderDetail('/plugins/acme');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'acme' })).toBeInTheDocument();
    });
    // kind appears in the header badge, in the meta grid and on the kinds tab.
    expect(screen.getAllByText('git').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('@v1.0.0')).toBeInTheDocument();
    expect(screen.getAllByText(ACTIVE.items[0].source).length).toBeGreaterThanOrEqual(1);
  });

  it('lists one artifact row per platform, each with its own digest', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: ACTIVE }]);
    renderDetail('/plugins/acme');
    await waitFor(() => expect(screen.getByTestId('plugin-artifacts-table')).toBeInTheDocument());

    // The digest is per platform: a single scalar would be the pre-NIM-794 shape,
    // and would silently show one platform's hash for all of them.
    expect(screen.getByText(LINUX_AMD64_SHA)).toBeInTheDocument();
    expect(screen.getByText(DARWIN_ARM64_SHA)).toBeInTheDocument();
    expect(screen.getByText('soul-mod-acme_linux_amd64')).toBeInTheDocument();
    expect(screen.getByText('soul-mod-acme_darwin_arm64')).toBeInTheDocument();
  });

  it('empty state when no record exists', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: { items: [] } }]);
    renderDetail('/plugins/unknown');
    await waitFor(() => {
      expect(screen.getByText(/No active Sigil grant/i)).toBeInTheDocument();
    });
  });

  it('Audit tab filters events by alias from payload', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/plugins/sigils', body: ACTIVE },
      { method: 'GET', url: '/v1/audit', body: AUDIT },
    ]);
    renderDetail('/plugins/acme');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'acme' })).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Audit history/i }));
    await waitFor(() => {
      expect(screen.getByText('plugin.allowed')).toBeInTheDocument();
    });
    // other-mod in payload - must NOT be matched.
    expect(screen.queryByText('other-mod')).not.toBeInTheDocument();
  });

  it('Plugin kinds tab explains how the bytes reach the host', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/plugins/sigils', body: ACTIVE }]);
    renderDetail('/plugins/acme');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'acme' })).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Plugin kinds/i }));
    expect(screen.getByText(/checks the source out at the granted ref/i)).toBeInTheDocument();
    expect(screen.getByText(/published under a base URL/i)).toBeInTheDocument();
    // The retired namespaces must not come back as kinds.
    expect(screen.queryByText(/cloud_driver/i)).not.toBeInTheDocument();
  });
});
