import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { PluginRegisterForm } from '../pages/plugins/PluginRegisterForm';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

describe('PluginRegisterForm', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('Zod validation rejects an alias that is not kebab-case', async () => {
    installFetchMock([
      { method: 'POST', url: '/v1/plugins/sigils', status: 201, body: {} },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/plugins/register" element={<PluginRegisterForm />} />
      </Routes>,
      '/plugins/register',
    );
    const user = userEvent.setup();
    // alias with uppercase and an underscore - not kebab-case.
    await user.type(screen.getByPlaceholderText('acme'), 'BAD_ALIAS');
    await user.type(screen.getByPlaceholderText(/soul-mod-acme\.git/i), 'https://git.example.com/soul-mod-acme.git');
    await user.type(screen.getByPlaceholderText(/v1\.2\.3/i), 'v1.0.0');
    await user.click(screen.getByRole('button', { name: /Allow/i }));
    // The field error replaces its own hint, so counting "kebab-case" matches
    // proves nothing. Assert the outcome instead: the pattern error is shown and
    // the grant request never leaves the form.
    await waitFor(() => {
      expect(screen.getByText(/\^\[a-z\]\[a-z0-9-\]\*\$/)).toBeInTheDocument();
    });
    const posts = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
      ([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase() === 'POST',
    );
    expect(posts).toHaveLength(0);
  });

  it('a successful POST shows a digest per artifact and the navigation buttons', async () => {
    installFetchMock([
      {
        method: 'POST',
        url: '/v1/plugins/sigils',
        status: 201,
        body: {
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
        },
      },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/plugins/register" element={<PluginRegisterForm />} />
      </Routes>,
      '/plugins/register',
    );
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('acme'), 'acme');
    await user.type(screen.getByPlaceholderText(/soul-mod-acme\.git/i), 'https://git.example.com/soul-mod-acme.git');
    await user.type(screen.getByPlaceholderText(/v1\.2\.3/i), 'v1.0.0');
    await user.click(screen.getByRole('button', { name: /Allow/i }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Plugin allowed/i })).toBeInTheDocument();
    });
    expect(screen.getByTestId('plugin-allowed-digests')).toHaveTextContent(
      'linux/amd64 — abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    );
    expect(screen.getByRole('button', { name: /Go to record/i })).toBeInTheDocument();
  });

  it('422 shows validation prettyprint', async () => {
    installFetchMock([
      {
        method: 'POST',
        url: '/v1/plugins/sigils',
        status: 422,
        body: { title: 'invalid', detail: 'ref must be a tag-ref' },
      },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/plugins/register" element={<PluginRegisterForm />} />
      </Routes>,
      '/plugins/register',
    );
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('acme'), 'acme');
    await user.type(screen.getByPlaceholderText(/soul-mod-acme\.git/i), 'https://git.example.com/soul-mod-acme.git');
    await user.type(screen.getByPlaceholderText(/v1\.2\.3/i), 'v1.0.0');
    await user.click(screen.getByRole('button', { name: /Allow/i }));
    await waitFor(() => {
      expect(screen.getByText(/Validation:/i)).toBeInTheDocument();
    });
  });

  it('404 explains that the release could not be resolved', async () => {
    installFetchMock([
      {
        method: 'POST',
        url: '/v1/plugins/sigils',
        status: 404,
        body: { title: 'release-not-found', detail: 'no release at that ref' },
      },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/plugins/register" element={<PluginRegisterForm />} />
      </Routes>,
      '/plugins/register',
    );
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('acme'), 'acme');
    await user.type(screen.getByPlaceholderText(/soul-mod-acme\.git/i), 'https://git.example.com/soul-mod-acme.git');
    await user.type(screen.getByPlaceholderText(/v1\.2\.3/i), 'v1.0.0');
    await user.click(screen.getByRole('button', { name: /Allow/i }));
    await waitFor(() => {
      expect(screen.getByText(/could not resolve a release/i)).toBeInTheDocument();
    });
  });
});
