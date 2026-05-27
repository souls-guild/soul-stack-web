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

  it('Zod-валидация не пускает невалидные namespace/name/ref', async () => {
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
    // namespace с заглавными — не kebab-case.
    await user.type(screen.getByPlaceholderText(/mod \/ cloud \/ ssh/i), 'BAD_NS');
    await user.type(screen.getByPlaceholderText(/soul-mod-acme/i), 'good-name');
    await user.type(screen.getByPlaceholderText(/v1\.2\.3/i), 'v1.0.0');
    await user.click(screen.getByRole('button', { name: /Допустить/i }));
    await waitFor(() => {
      // "kebab-case" встречается и в hint, и в error-message; должно стать
      // минимум двух (hint всегда + error от Zod-резолвера на BAD_NS).
      const matches = screen.getAllByText(/kebab-case/i);
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('успешный POST → показывает sha256 и кнопки навигации', async () => {
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
    await user.click(screen.getByRole('button', { name: /Допустить/i }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Плагин допущен/i })).toBeInTheDocument();
    });
    expect(
      screen.getByText('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /К записи/i })).toBeInTheDocument();
  });

  it('422 показывает validation-prettyprint', async () => {
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
    await user.click(screen.getByRole('button', { name: /Допустить/i }));
    await waitFor(() => {
      expect(screen.getByText(/Validation:/i)).toBeInTheDocument();
    });
  });

  it('404 объясняет про "плагин не в кеше"', async () => {
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
    await user.click(screen.getByRole('button', { name: /Допустить/i }));
    await waitFor(() => {
      expect(screen.getByText(/Плагин не найден в кеше host-а/i)).toBeInTheDocument();
    });
  });
});
