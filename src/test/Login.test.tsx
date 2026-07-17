import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { Login } from '../pages/Login';
import { AuthProvider } from '../hooks/AuthProvider';
import { tokenStore } from '../api/tokenStore';
import { installFetchMock } from './fetchMock';

describe('Login', () => {
  beforeEach(() => {
    tokenStore.clear();
    installFetchMock([]);
  });

  it('renders without errors and shows the JWT form', () => {
    renderWithProviders(
      <AuthProvider>
        <Login />
      </AuthProvider>,
      '/login',
    );
    expect(screen.getByRole('heading', { name: /Soul Stack/i })).toBeInTheDocument();
    expect(screen.getByText(/Keeper UI · Archon login/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign in/i })).toBeInTheDocument();
  });

  it('validates empty input via zod', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AuthProvider>
        <Login />
      </AuthProvider>,
      '/login',
    );
    await user.click(screen.getByRole('button', { name: /Sign in/i }));
    expect(await screen.findByText(/paste the Archon JWT token/i)).toBeInTheDocument();
  });

  it('rejects a string that does not look like a JWT', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AuthProvider>
        <Login />
      </AuthProvider>,
      '/login',
    );
    const ta = screen.getByPlaceholderText(/eyJhbGciOi/);
    await user.type(ta, 'not-a-jwt');
    await user.click(screen.getByRole('button', { name: /Sign in/i }));
    expect(await screen.findByText(/does not look like a JWT/i)).toBeInTheDocument();
  });
});
