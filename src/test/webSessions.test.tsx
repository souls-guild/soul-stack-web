import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { Login } from '../pages/Login';
import { AuthProvider } from '../hooks/AuthProvider';
import { useAuth } from '../hooks/useAuth';
import { ProfilePage } from '../pages/profile/ProfilePage';
import { tokenStore } from '../api/tokenStore';
import { summarizeUserAgent } from '../pages/profile/userAgent';

// Web sessions: LDAP and SSO sign-in, a sign-out that ends the session on
// Keeper, and Profile → Sessions.

interface Call {
  url: string;
  method: string;
  body: unknown;
}

type Reply = { status: number; body?: unknown };

function stubFetch(handler: (url: string, method: string, body: unknown) => Reply | undefined): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      const r = handler(url, method, body);
      if (!r) return new Response(JSON.stringify({ title: 'not mocked', detail: url }), { status: 599 });
      if (r.status === 204) return new Response(null, { status: 204 });
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return calls;
}

const HERE = '01JHERE000000000000000000A';
const LAPTOP = '01JLAPT0P00000000000000000';
const OLD = '01J0LD00000000000000000000';

function jwt(sub: string, jti: string): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'HS256' })}.${b64({ sub, jti, iat: now, exp: now + 600 })}.sig`;
}

const PING = { status: 200, body: { items: [], offset: 0, limit: 1, total: 0 } };
const tokenReply = (token: string): Reply => ({ status: 200, body: { token, expires_at: '2099-01-01T00:00:00Z' } });

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="login-location">{`${loc.pathname}${loc.search}`}</div>;
}

function renderLogin(path = '/login') {
  renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<><Login /><LocationProbe /></>} />
        <Route path="/incarnations" element={<div data-testid="landed">landed</div>} />
        <Route path="/souls" element={<div data-testid="landed-souls">souls</div>} />
      </Routes>
    </AuthProvider>,
    path,
  );
}

beforeEach(() => {
  tokenStore.clear();
  tokenStore.clearSession();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('login form', () => {
  it('signs in through LDAP: the directory login, then the cookie exchange', async () => {
    const calls = stubFetch((url, method) => {
      if (url === '/auth/methods') return { status: 200, body: { password: true, ldap: true, oidc: false, local: false } };
      if (url === '/auth/ldap/login' && method === 'POST') return { status: 204 };
      if (url === '/auth/token') return tokenReply(jwt('ivanov', HERE));
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderLogin();
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('login-ldap-login'), 'i.ivanov');
    await user.type(screen.getByTestId('login-ldap-password'), 'directory pass');
    await user.click(screen.getByTestId('login-ldap-submit'));
    expect(await screen.findByTestId('landed')).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/auth/ldap/login')?.body).toEqual({ username: 'i.ivanov', password: 'directory pass' });
    expect(tokenStore.sessionMethod()).toBe('ldap');
    expect(tokenStore.identity()?.aid).toBe('ivanov');
  });

  it('says so when no directory group gives a role', async () => {
    stubFetch((url) => {
      if (url === '/auth/methods') return { status: 200, body: { password: true, ldap: true, oidc: false, local: false } };
      if (url === '/auth/ldap/login') return { status: 403, body: { type: 'https://soul-stack.com/errors/forbidden', title: 'Forbidden', detail: 'no mapped group' } };
      return undefined;
    });
    renderLogin();
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('login-ldap-login'), 'i.ivanov');
    await user.type(screen.getByTestId('login-ldap-password'), 'directory pass');
    await user.click(screen.getByTestId('login-ldap-submit'));
    expect(await screen.findByTestId('login-error')).toHaveTextContent('none of your groups gives a role');
    expect(tokenStore.isSession()).toBe(false);
  });

  it('shows Keeper\'s own words when LDAP provisioning is off', async () => {
    stubFetch((url) => {
      if (url === '/auth/methods') return { status: 200, body: { password: true, ldap: true, oidc: false, local: false } };
      if (url === '/auth/ldap/login') {
        return { status: 403, body: { type: 'https://soul-stack.com/errors/provisioning-method-disabled', title: 'Forbidden', detail: 'operator provisioning is disabled for this method by policy' } };
      }
      return undefined;
    });
    renderLogin();
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('login-ldap-login'), 'newcomer');
    await user.type(screen.getByTestId('login-ldap-password'), 'directory pass');
    await user.click(screen.getByTestId('login-ldap-submit'));
    const err = await screen.findByTestId('login-error');
    expect(err).toHaveTextContent('provisioning is disabled');
    expect(err).not.toHaveTextContent('none of your groups');
  });

  it('offers SSO only when Keeper has OIDC, and leaves for the IdP remembering where to return', async () => {
    stubFetch((url) => (url === '/auth/methods' ? { status: 200, body: { password: true, ldap: false, oidc: true, local: false } } : undefined));
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    renderLogin();
    await userEvent.setup().click(await screen.findByTestId('login-sso'));
    expect(assign).toHaveBeenCalledWith('/auth/oidc/login');
    expect(sessionStorage.getItem('soul-stack.sso-return')).toBe('/incarnations');
  });

  it('has no SSO button without OIDC', async () => {
    stubFetch((url) => (url === '/auth/methods' ? { status: 200, body: { password: true, ldap: false, oidc: false, local: true } } : undefined));
    renderLogin();
    await screen.findByTestId('login-local-form');
    expect(screen.queryByTestId('login-sso')).toBeNull();
  });

  it('finishes an SSO sign-in on the landing: exchanges the cookie and returns where the operator left', async () => {
    sessionStorage.setItem('soul-stack.sso-return', '/souls');
    const calls = stubFetch((url) => {
      if (url === '/auth/methods') return { status: 200, body: { password: true, ldap: false, oidc: true, local: false } };
      if (url === '/auth/token') return tokenReply(jwt('alice', HERE));
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderLogin('/login?sso=done');
    expect(await screen.findByTestId('landed-souls')).toBeInTheDocument();
    expect(calls.filter((c) => c.url === '/auth/token')).toHaveLength(1);
    expect(tokenStore.sessionMethod()).toBe('oidc');
  });

  it('shows why when the SSO landing has no session to exchange, and keeps the form', async () => {
    sessionStorage.setItem('soul-stack.sso-return', '/incarnations');
    stubFetch((url) => {
      if (url === '/auth/methods') return { status: 200, body: { password: true, ldap: false, oidc: true, local: false } };
      if (url === '/auth/token') return { status: 401, body: { title: 'Unauthorized' } };
      return undefined;
    });
    renderLogin('/login?sso=done');
    expect(await screen.findByTestId('login-sso-error')).toHaveTextContent('SSO sign-in did not finish');
    expect(await screen.findByTestId('login-sso')).toBeInTheDocument();
    expect(tokenStore.isSession()).toBe(false);
    // Off the landing URL: going back from a later SSO start abandoned at the IdP shows a plain /login.
    await waitFor(() => expect(screen.getByTestId('login-location')).toHaveTextContent(/^\/login$/));
  });

  it('never returns to another origin from the stored SSO destination', async () => {
    sessionStorage.setItem('soul-stack.sso-return', '//evil.example/x');
    stubFetch((url) => {
      if (url === '/auth/methods') return { status: 200, body: { password: true, ldap: false, oidc: true, local: false } };
      if (url === '/auth/token') return tokenReply(jwt('alice', HERE));
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderLogin('/login?sso=done');
    expect(await screen.findByTestId('landed')).toBeInTheDocument();
  });
});

function LogoutProbe() {
  const { identity, logout } = useAuth();
  return (
    <>
      <div data-testid="probe">{identity?.aid ?? 'none'}</div>
      <button type="button" data-testid="probe-logout" onClick={() => void logout()}>logout</button>
    </>
  );
}

describe('SSO landing elsewhere', () => {
  it('forgets an SSO sign-in abandoned at the IdP once the form is shown again', async () => {
    sessionStorage.setItem('soul-stack.sso-return', '/souls');
    stubFetch((url) => (url === '/auth/methods' ? { status: 200, body: { password: true, ldap: false, oidc: true, local: true } } : undefined));
    renderLogin('/login');
    await screen.findByTestId('login-local-form');
    expect(sessionStorage.getItem('soul-stack.sso-return')).toBeNull();
  });

  it('exchanges nothing in a tab that did not start the SSO sign-in', async () => {
    const calls = stubFetch((url) => {
      if (url === '/auth/methods') return { status: 200, body: { password: true, ldap: false, oidc: true, local: true } };
      if (url === '/auth/token') return tokenReply(jwt('mallory', HERE));
      return undefined;
    });
    renderLogin('/login?sso=done');
    await screen.findByTestId('login-local-form');
    expect(calls.some((c) => c.url === '/auth/token')).toBe(false);
    expect(tokenStore.isSession()).toBe(false);
    await waitFor(() => expect(screen.getByTestId('login-location')).toHaveTextContent(/^\/login$/));
  });

  it('does not switch who a signed-in tab is', async () => {
    sessionStorage.setItem('soul-stack.sso-return', '/souls');
    tokenStore.startSession(jwt('alice', LAPTOP), 'local');
    const calls = stubFetch((url) => {
      if (url === '/auth/methods') return { status: 200, body: { password: true, ldap: false, oidc: true, local: true } };
      if (url === '/auth/token') return tokenReply(jwt('mallory', HERE));
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderLogin('/login?sso=done');
    expect(await screen.findByTestId('landed-souls')).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/auth/token')).toBe(false);
    expect(tokenStore.identity()?.aid).toBe('alice');
    expect(sessionStorage.getItem('soul-stack.sso-return')).toBeNull();
  });
});

describe('sign-out', () => {
  it('ends a cookie session on Keeper, not only in this browser', async () => {
    tokenStore.startSession(jwt('alice', HERE), 'local');
    const calls = stubFetch((url, method) => {
      if (url.startsWith('/v1/incarnations')) return PING;
      if (method === 'POST' && url === `/v1/me/jwts/${HERE}/revoke`) return { status: 204 };
      return undefined;
    });
    renderWithProviders(<AuthProvider><LogoutProbe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('alice'));
    await userEvent.setup().click(screen.getByTestId('probe-logout'));
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('none'));
    expect(calls.some((c) => c.method === 'POST' && c.url === `/v1/me/jwts/${HERE}/revoke`)).toBe(true);
    expect(tokenStore.isSession()).toBe(false);
  });

  it('exchanges a stale Bearer first, so the revoke goes out with a live one', async () => {
    tokenStore.startSession(jwt('alice', HERE), 'local');
    const fresh = jwt('alice', HERE).replace('.sig', '.fresh');
    const calls: { url: string; auth?: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        calls.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
        const json = (status: number, body?: unknown) =>
          new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
        if (url.startsWith('/v1/incarnations')) return json(200, PING.body);
        if (url === '/auth/token') return json(200, { token: fresh, expires_at: '2099-01-01T00:00:00Z' });
        if (url === `/v1/me/jwts/${HERE}/revoke`) return new Response(null, { status: 204 });
        return json(599, {});
      }),
    );
    renderWithProviders(<AuthProvider><LogoutProbe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('alice'));
    tokenStore.markSessionBearerStale();
    await userEvent.setup().click(screen.getByTestId('probe-logout'));
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('none'));
    const revoke = calls.find((c) => c.url === `/v1/me/jwts/${HERE}/revoke`);
    expect(revoke?.auth).toBe(`Bearer ${fresh}`);
  });

  it('only forgets a pasted token: it may be a script\'s', async () => {
    tokenStore.set(jwt('alice', HERE));
    const calls = stubFetch((url) => (url.startsWith('/v1/incarnations') ? PING : undefined));
    renderWithProviders(<AuthProvider><LogoutProbe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('alice'));
    await userEvent.setup().click(screen.getByTestId('probe-logout'));
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('none'));
    expect(calls.some((c) => c.url.includes('/revoke'))).toBe(false);
  });

  it('signs out here even when Keeper cannot end the session', async () => {
    tokenStore.startSession(jwt('alice', HERE), 'local');
    stubFetch((url) => (url.startsWith('/v1/incarnations') ? PING : { status: 500, body: { title: 'boom' } }));
    renderWithProviders(<AuthProvider><LogoutProbe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('alice'));
    await userEvent.setup().click(screen.getByTestId('probe-logout'));
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('none'));
  });
});

function session(over: Record<string, unknown>) {
  return {
    jwt_id: HERE,
    aid: 'alice',
    kind: 'session',
    created_at: '2026-10-25T09:12:00Z',
    expires_at: '2099-11-01T09:12:00Z',
    created_ip: '10.24.7.18',
    created_user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    last_used_at: new Date().toISOString(),
    last_used_ip: '10.24.7.18',
    ...over,
  };
}

const ROWS = [
  session({}),
  session({
    jwt_id: LAPTOP,
    created_ip: '10.24.9.3',
    created_user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:132.0) Gecko/20100101 Firefox/132.0',
    last_used_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    last_used_ip: '10.24.9.77',
  }),
];

function mockSessions(rows: unknown[] = ROWS, revoked = 1): Call[] {
  return stubFetch((url, method) => {
    if (url.startsWith('/v1/incarnations')) return PING;
    if (method === 'GET' && url.startsWith('/v1/me/jwts')) {
      const active = url.includes('state=active');
      const items = active ? rows.filter((r) => !(r as { revoked_at?: string }).revoked_at) : rows;
      return { status: 200, body: { items, offset: 0, limit: 50, total: items.length, personal_ttl_max_seconds: 1, personal_active: 0, personal_limit: 10, personal_last_day: 0, personal_daily_limit: 20 } };
    }
    if (method === 'POST' && /^\/v1\/me\/jwts\/[^/]+\/revoke$/.test(url)) return { status: 204 };
    if (method === 'POST' && url === '/v1/me/sessions/revoke') return { status: 200, body: { revoked } };
    if (method === 'GET' && url.startsWith('/v1/operators/')) return { status: 403, body: { title: 'Forbidden' } };
    return undefined;
  });
}

function renderSessions() {
  return renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route path="/profile/*" element={<ProfilePage />} />
        <Route path="/login" element={<div data-testid="login-page" />} />
      </Routes>
    </AuthProvider>,
    '/profile/sessions',
  );
}

describe('Profile → Sessions', () => {
  it('shows each session as a person recognises it and marks this one', async () => {
    tokenStore.startSession(jwt('alice', HERE), 'local');
    const calls = mockSessions();
    renderSessions();
    const here = await screen.findByTestId(`session-${HERE}`);
    expect(here).toHaveTextContent('Chrome 131 · Windows');
    expect(here).toHaveTextContent('this session');
    expect(here).toHaveTextContent('10.24.7.18');
    expect(here).toHaveTextContent('active now');
    const laptop = screen.getByTestId(`session-${LAPTOP}`);
    expect(laptop).toHaveTextContent('Firefox 132 · macOS');
    expect(laptop).not.toHaveTextContent('this session');
    expect(laptop).toHaveTextContent('from 10.24.9.77');
    expect(screen.getByTestId(`session-end-${HERE}`)).toHaveTextContent('Sign out');
    expect(screen.getByTestId(`session-end-${LAPTOP}`)).toHaveTextContent('End');
    const list = calls.find((c) => c.method === 'GET' && c.url.startsWith('/v1/me/jwts') && c.url.includes('offset'));
    expect(list?.url).toContain('kind=session');
  });

  it('ends one other session and stays signed in', async () => {
    tokenStore.startSession(jwt('alice', HERE), 'local');
    const calls = mockSessions();
    renderSessions();
    await userEvent.setup().click(await screen.findByTestId(`session-end-${LAPTOP}`));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === `/v1/me/jwts/${LAPTOP}/revoke`)).toBe(true));
    expect(tokenStore.isSession()).toBe(true);
    expect(screen.queryByTestId('login-page')).toBeNull();
  });

  it('ends the other sessions, keeping this one', async () => {
    tokenStore.startSession(jwt('alice', HERE), 'local');
    const calls = mockSessions(ROWS, 1);
    renderSessions();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('sessions-end-others')).toBeEnabled());
    await user.click(screen.getByTestId('sessions-end-others'));
    expect(screen.getByRole('dialog')).toHaveTextContent('other browsers to end: 1');
    await user.click(screen.getByTestId('sessions-confirm'));
    expect(await screen.findByTestId('sessions-notice')).toHaveTextContent('Sessions ended: 1');
    expect(calls.find((c) => c.url === '/v1/me/sessions/revoke')?.body).toEqual({ keep_current: true });
    expect(tokenStore.isSession()).toBe(true);
  });

  it('ends every session, this one included, and goes to the sign-in page', async () => {
    tokenStore.startSession(jwt('alice', HERE), 'local');
    const calls = mockSessions(ROWS, 2);
    renderSessions();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('sessions-end-all')).toBeEnabled());
    await user.click(screen.getByTestId('sessions-end-all'));
    expect(screen.getByRole('dialog')).toHaveTextContent('this one included');
    await user.click(screen.getByTestId('sessions-confirm'));
    expect(await screen.findByTestId('login-page')).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/v1/me/sessions/revoke')?.body).toEqual({ keep_current: false });
    expect(tokenStore.isSession()).toBe(false);
  });

  it('signs out from this session\'s card', async () => {
    tokenStore.startSession(jwt('alice', HERE), 'local');
    const calls = mockSessions();
    renderSessions();
    await userEvent.setup().click(await screen.findByTestId(`session-end-${HERE}`));
    expect(await screen.findByTestId('login-page')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url === `/v1/me/jwts/${HERE}/revoke`)).toBe(true);
  });

  it('shows ended sessions only when asked, without an end button', async () => {
    tokenStore.startSession(jwt('alice', HERE), 'local');
    mockSessions([...ROWS, session({ jwt_id: OLD, revoked_at: '2026-10-20T10:00:00Z' })]);
    renderSessions();
    await screen.findByTestId(`session-${HERE}`);
    expect(screen.queryByTestId(`session-${OLD}`)).toBeNull();
    await userEvent.setup().click(screen.getByTestId('sessions-show-ended'));
    const old = await screen.findByTestId(`session-${OLD}`);
    expect(old).toHaveTextContent('ended 2026-10-20 10:00');
    expect(screen.queryByTestId(`session-end-${OLD}`)).toBeNull();
  });
});

describe('summarizeUserAgent', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Chrome 131', 'Windows', 'desktop'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.70', 'Edge 131', 'Windows', 'desktop'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:132.0) Gecko/20100101 Firefox/132.0', 'Firefox 132', 'macOS', 'desktop'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'Safari 18', 'macOS', 'desktop'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari 18', 'iOS', 'mobile'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', 'Chrome 131', 'Android', 'mobile'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0', 'Opera 115', 'Linux', 'desktop'],
    ['curl/8.5.0', 'curl 8.5.0', null, 'tool'],
  ])('%s', (ua, browser, os, device) => {
    expect(summarizeUserAgent(ua)).toEqual({ browser, os, device });
  });

  it('knows nothing of an empty header', () => {
    expect(summarizeUserAgent(undefined)).toEqual({ browser: null, os: null, device: 'desktop' });
  });
});
