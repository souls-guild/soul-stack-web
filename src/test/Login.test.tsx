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

  it('рендерится без ошибок и показывает форму JWT', () => {
    renderWithProviders(
      <AuthProvider>
        <Login />
      </AuthProvider>,
      '/login',
    );
    expect(screen.getByRole('heading', { name: /Soul Stack/i })).toBeInTheDocument();
    expect(screen.getByText(/Keeper UI · вход Архонта/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Войти/i })).toBeInTheDocument();
  });

  it('валидирует пустой ввод через zod', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AuthProvider>
        <Login />
      </AuthProvider>,
      '/login',
    );
    await user.click(screen.getByRole('button', { name: /Войти/i }));
    expect(await screen.findByText(/вставьте JWT-токен/i)).toBeInTheDocument();
  });

  it('отвергает строку, не похожую на JWT', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AuthProvider>
        <Login />
      </AuthProvider>,
      '/login',
    );
    const ta = screen.getByPlaceholderText(/eyJhbGciOi/);
    await user.type(ta, 'not-a-jwt');
    await user.click(screen.getByRole('button', { name: /Войти/i }));
    expect(await screen.findByText(/не похоже на JWT/i)).toBeInTheDocument();
  });
});
