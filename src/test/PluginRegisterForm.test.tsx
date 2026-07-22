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

  it('Zod validation rejects invalid namespace/name/ref', async () => {
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
    // namespace with uppercase - not kebab-case.
    await user.type(screen.getByPlaceholderText(/mod \/ cloud \/ ssh/i), 'BAD_NS');
    await user.type(screen.getByPlaceholderText(/soul-mod-acme/i), 'good-name');
    await user.type(screen.getByPlaceholderText(/v1\.2\.3/i), 'v1.0.0');
    await user.click(screen.getByRole('button', { name: /Allow/i }));
    await waitFor(() => {
      // "kebab-case" appears both in hint and in error-message; should become
      // at least two (hint always + error from the Zod resolver on BAD_NS).
      const matches = screen.getAllByText(/kebab-case/i);
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('successful POST shows sha256 and navigation buttons', async () => {
    installFetchMock([
      {
        method: 'POST',
        url: '/v1/plugins/sigils',
        status: 201,
        body: {
          namespace: 'mod',
          name: 'soul-mod-acme',
          ref: 'v1.0.0',
          sha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
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
    await user.type(screen.getByPlaceholderText(/mod \/ cloud \/ ssh/i), 'mod');
    await user.type(screen.getByPlaceholderText(/soul-mod-acme/i), 'soul-mod-acme');
    await user.type(screen.getByPlaceholderText(/v1\.2\.3/i), 'v1.0.0');
    await user.click(screen.getByRole('button', { name: /Allow/i }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Plugin allowed/i })).toBeInTheDocument();
    });
    expect(
      screen.getByText('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'),
    ).toBeInTheDocument();
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
    await user.type(screen.getByPlaceholderText(/mod \/ cloud \/ ssh/i), 'mod');
    await user.type(screen.getByPlaceholderText(/soul-mod-acme/i), 'soul-mod-acme');
    await user.type(screen.getByPlaceholderText(/v1\.2\.3/i), 'v1.0.0');
    await user.click(screen.getByRole('button', { name: /Allow/i }));
    await waitFor(() => {
      expect(screen.getByText(/Validation:/i)).toBeInTheDocument();
    });
  });

  it('404 explains "plugin not in cache"', async () => {
    installFetchMock([
      {
        method: 'POST',
        url: '/v1/plugins/sigils',
        status: 404,
        body: { title: 'plugin-not-in-cache', detail: 'no cached binary' },
      },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/plugins/register" element={<PluginRegisterForm />} />
      </Routes>,
      '/plugins/register',
    );
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/mod \/ cloud \/ ssh/i), 'mod');
    await user.type(screen.getByPlaceholderText(/soul-mod-acme/i), 'soul-mod-acme');
    await user.type(screen.getByPlaceholderText(/v1\.2\.3/i), 'v1.0.0');
    await user.click(screen.getByRole('button', { name: /Allow/i }));
    await waitFor(() => {
      expect(screen.getByText(/Plugin not found in the host's cache/i)).toBeInTheDocument();
    });
  });
});
