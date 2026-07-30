import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, type InitialEntry } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../hooks/AuthProvider';
import { ThemeProvider } from '../hooks/useTheme';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { Login } from '../pages/Login';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

// header.{"sub":"archon-alice"}.signature — decodable by tokenStore and shaped
// to pass the login form's format check.
const TOKEN = 'aaa.eyJzdWIiOiJhcmNob24tYWxpY2UifQ.bbb';

// The page an operator is actually on when the token expires: a filtered list.
// The filter lives in the query string — the half a pathname-only round trip
// silently drops, which reads as "it did not return me" rather than as data loss.
const DEEP_LINK = '/souls?coven=prod&status=connected';

function Probe() {
  const loc = useLocation();
  return (
    <>
      <span data-testid="here">{`${loc.pathname}${loc.search}${loc.hash}`}</span>
      <span data-testid="carried">{JSON.stringify(loc.state ?? null)}</span>
    </>
  );
}

function renderApp(entry: InitialEntry) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } },
  });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[entry]}>
          <AuthProvider>
            <Probe />
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/souls" element={<ProtectedRoute><div>souls</div></ProtectedRoute>} />
              <Route
                path="/incarnations"
                element={<ProtectedRoute><div>incarnations</div></ProtectedRoute>}
              />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('login returns the operator to where they were sent away from', () => {
  beforeEach(() => {
    tokenStore.clear();
    installFetchMock([
      { method: 'GET', url: '/v1/incarnations', body: { items: [], limit: 1, offset: 0, total: 0 } },
    ]);
  });

  it('restores the whole location, query string included', async () => {
    renderApp(DEEP_LINK);

    await screen.findByTestId('login-token-input');
    expect(screen.getByTestId('here').textContent, 'an unauthenticated deep link must land on /login').toBe(
      '/login',
    );
    // Pin down which half is broken: the redirect carrying the origin, or the
    // login reading it back. ProtectedRoute hands over the whole location, so
    // the query is present here even when the return trip loses it.
    expect(
      JSON.parse(screen.getByTestId('carried').textContent ?? 'null')?.from,
      'the redirect must carry the full origin location, not just its path',
    ).toMatchObject({ pathname: '/souls', search: '?coven=prod&status=connected' });

    await userEvent.type(screen.getByTestId('login-token-input'), TOKEN);
    await userEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() =>
      expect(
        screen.getByTestId('here').textContent,
        'after login the operator must be back on the exact page, filter and all — ' +
          'returning to the bare path loses the query and reads as "it did not return me"',
      ).toBe(DEEP_LINK),
    );
  });

  // Separate hole, and it does not need the login form at all: an operator who
  // is already authenticated but lands on /login carrying a `from` must still be
  // taken to `from`. A hardcoded destination here also sits one flush away from
  // overriding the post-submit navigation above.
  it('an already-authenticated operator carrying a `from` is taken there, not to a fixed page', async () => {
    tokenStore.set(TOKEN);

    renderApp({ pathname: '/login', state: { from: { pathname: '/souls', search: '?coven=prod' } } });

    await waitFor(() =>
      expect(
        screen.getByTestId('here').textContent,
        'the early return must honour `from` instead of sending everyone to one fixed page',
      ).toBe('/souls?coven=prod'),
    );
  });
});
