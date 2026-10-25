import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { Login } from '../pages/Login';
import { AuthProvider } from '../hooks/AuthProvider';
import { useAuth } from '../hooks/useAuth';
import { ArchonsList } from '../pages/archons/ArchonsList';
import { ArchonDetail } from '../pages/archons/ArchonDetail';
import { tokenStore } from '../api/tokenStore';
import { keeperApi } from '../api/keeper';
import { apiSend } from '../api/client';
import { createWebSocketTransport } from '../api/consoleSocket';
import { subscribeRunEvents } from '../api/runEvents';
import { ProfilePage } from '../pages/profile/ProfilePage';
import { normalizeLoginAID } from '../api/loginAID';

// Local-password login and administration (NIM-1051).

interface Call {
  url: string;
  method: string;
  body: string | null;
  auth: string | undefined;
}

type Reply = { status: number; body?: unknown };
type Handler = (url: string, method: string, body: string | null, auth: string | undefined) => Reply | undefined | Promise<Reply | undefined>;

function stubFetch(handler: Handler): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : null;
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    calls.push({ url, method, body, auth });
    const r = await handler(url, method, body, auth);
    if (!r) {
      return new Response(JSON.stringify({ title: 'not mocked', detail: url }), { status: 599 });
    }
    if (r.status === 204) return new Response(null, { status: 204 });
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
  return calls;
}

// A JWT the token store can read: base64url payload with sub, iat (now) and exp.
function jwtFor(sub: string, expInSec: number): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'HS256' })}.${b64({ sub, iat: now, exp: now + expInSec })}.sig`;
}

// A JWT with an explicit iat and exp (seconds), for a Keeper clock that is not
// this browser's.
function jwtWith(sub: string, iat: number, exp: number): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256' })}.${b64({ sub, iat, exp })}.sig`;
}

function tokenReply(token: string): Reply {
  return { status: 200, body: { token, expires_at: '2099-01-01T00:00:00Z' } };
}

const exchanges = (calls: Call[]) => calls.filter((c) => c.url === '/auth/token').length;

const PING = { status: 200, body: { items: [], offset: 0, limit: 1, total: 0 } };
const METHODS_LOCAL = { status: 200, body: { password: true, ldap: false, oidc: false, local: true } };
const METHODS_NO_LOCAL = { status: 200, body: { password: true, ldap: false, oidc: false, local: false } };

function renderLogin() {
  renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/incarnations" element={<div data-testid="landed">landed</div>} />
      </Routes>
    </AuthProvider>,
    '/login',
  );
}

function Probe() {
  const { identity, isVerifying, logout } = useAuth();
  return (
    <>
      <div data-testid="probe">{identity?.aid ?? 'none'}</div>
      <div data-testid="verifying">{String(isVerifying)}</div>
      <button type="button" data-testid="probe-logout" onClick={() => void logout()}>logout</button>
    </>
  );
}

function renderProbe() {
  return renderWithProviders(<AuthProvider><Probe /></AuthProvider>);
}

// renderWithClient — renderWithProviders with the QueryClient in hand, so a
// test can wait for a reply to land rather than for a call to be made.
function renderWithClient(ui: ReactNode, path: string): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}>{children}</MemoryRouter></QueryClientProvider>
  );
  render(<>{ui}</>, { wrapper: Wrap });
  return qc;
}

// A session Bearer as a password login leaves it: stored with a session id.
function seedSession(token: string) {
  tokenStore.startSession(token, 'local');
}

beforeEach(() => {
  tokenStore.clear();
  tokenStore.clearSession();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('login form', () => {
  it('offers only the token form when the Keeper has no auth.local', async () => {
    stubFetch((url) => (url === '/auth/methods' ? METHODS_NO_LOCAL : undefined));
    renderLogin();
    // A placeholder stands until /auth/methods answers; the token form follows it.
    expect(screen.getByTestId('login-methods-loading')).toBeInTheDocument();
    expect(await screen.findByTestId('login-token-input')).toBeInTheDocument();
    expect(screen.queryByTestId('login-method-local')).toBeNull();
    expect(screen.queryByTestId('login-local-form')).toBeNull();
  });

  it('a password login posts the credentials, exchanges the cookie and keeps the Bearer', async () => {
    const bearer = jwtFor('alice', 600);
    const calls = stubFetch((url, method) => {
      if (url === '/auth/methods') return METHODS_LOCAL;
      if (url === '/auth/local/login' && method === 'POST') return { status: 204 };
      if (url === '/auth/token' && method === 'POST') return { status: 200, body: { token: bearer, expires_at: '2099-01-01T00:00:00Z' } };
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderLogin();
    const user = userEvent.setup();
    // The password form is the default once /auth/methods offers it.
    await user.type(await screen.findByTestId('login-local-login'), '  Alice ');
    await user.type(screen.getByTestId('login-local-password'), 'correct horse battery');
    await user.click(screen.getByTestId('login-local-submit'));

    await screen.findByTestId('landed');
    const login = calls.find((c) => c.url === '/auth/local/login');
    expect(JSON.parse(login!.body!)).toEqual({ aid: 'Alice', password: 'correct horse battery' });
    const order = calls.map((c) => c.url).filter((u) => u.startsWith('/auth/local') || u === '/auth/token');
    expect(order).toEqual(['/auth/local/login', '/auth/token']);
    expect(tokenStore.get()).toBe(bearer);
    expect(tokenStore.isSession()).toBe(true);
  });

  it('a refused password login shows one message, whatever the reason', async () => {
    stubFetch((url) => {
      if (url === '/auth/methods') return METHODS_LOCAL;
      if (url === '/auth/local/login') return { status: 401, body: { type: 'unauthenticated', detail: 'authentication failed' } };
      return undefined;
    });
    renderLogin();
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('login-local-login'), 'alice');
    await user.type(screen.getByTestId('login-local-password'), 'wrong');
    await user.click(screen.getByTestId('login-local-submit'));
    expect(await screen.findByTestId('login-error')).toHaveTextContent('Wrong AID or password.');
    expect(tokenStore.get()).toBeNull();
    expect(tokenStore.isSession()).toBe(false);
  });

  it('a locked-out login says to wait', async () => {
    stubFetch((url) => {
      if (url === '/auth/methods') return METHODS_LOCAL;
      if (url === '/auth/local/login') return { status: 429, body: { type: 'auth-throttled' } };
      return undefined;
    });
    renderLogin();
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('login-local-login'), 'alice');
    await user.type(screen.getByTestId('login-local-password'), 'x');
    await user.click(screen.getByTestId('login-local-submit'));
    expect(await screen.findByTestId('login-error')).toHaveTextContent(/Too many sign-in attempts/);
  });

  it('an accepted password whose cookie the browser did not keep says so, not "wrong password"', async () => {
    stubFetch((url) => {
      if (url === '/auth/methods') return METHODS_LOCAL;
      if (url === '/auth/local/login') return { status: 204 };
      if (url === '/auth/token') return { status: 401, body: { type: 'unauthenticated' } };
      return undefined;
    });
    renderLogin();
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('login-local-login'), 'alice');
    await user.type(screen.getByTestId('login-local-password'), 'correct horse battery');
    await user.click(screen.getByTestId('login-local-submit'));
    const err = await screen.findByTestId('login-error');
    expect(err).toHaveTextContent(/did not keep the session cookie/);
    expect(err).not.toHaveTextContent(/Wrong AID or password/);
    expect(tokenStore.isSession()).toBe(false);
  });
});

describe('session Bearer, exchanged when Keeper refuses it', () => {
  // ping as the client sends it: through the reactive 401 path.
  const ping = () => keeperApi.ping();

  it('a refused session Bearer is exchanged once and the request sent again', async () => {
    const stale = jwtFor('alice', 600);
    const fresh = jwtFor('alice', 600) + 'x';
    seedSession(stale);
    const calls = stubFetch((url, _m, _b, auth) => {
      if (url === '/auth/token') return tokenReply(fresh);
      if (url.startsWith('/v1/incarnations')) return auth === `Bearer ${fresh}` ? PING : { status: 401, body: { type: 'jwt-revoked' } };
      return undefined;
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('verifying')).toHaveTextContent('false'));
    expect(exchanges(calls)).toBe(1);
    const pings = calls.filter((c) => c.url.startsWith('/v1/incarnations'));
    expect(pings.map((c) => c.auth)).toEqual([`Bearer ${stale}`, `Bearer ${fresh}`]);
    expect(tokenStore.get()).toBe(fresh);
    expect(screen.getByTestId('probe')).toHaveTextContent('alice');
  });

  it('requests refused at the same time share one exchange', async () => {
    const stale = jwtFor('alice', 600);
    const fresh = jwtFor('alice', 600) + 'x';
    seedSession(stale);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const calls = stubFetch(async (url, _m, _b, auth) => {
      if (url === '/auth/token') { await gate; return tokenReply(fresh); }
      if (url.startsWith('/v1/incarnations')) return auth === `Bearer ${fresh}` ? PING : { status: 401, body: {} };
      return undefined;
    });
    renderProbe();
    const all = Promise.all([ping(), ping(), ping()]);
    await waitFor(() => expect(exchanges(calls)).toBe(1));
    release();
    await act(async () => { await all; });
    expect(exchanges(calls)).toBe(1);
  });

  it('an exchange Keeper refuses ends the session', async () => {
    seedSession(jwtFor('alice', 600));
    stubFetch((url) => {
      if (url === '/auth/token') return { status: 401, body: { type: 'unauthenticated' } };
      if (url.startsWith('/v1/incarnations')) return { status: 401, body: { type: 'jwt-revoked' } };
      return undefined;
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('none'));
    expect(tokenStore.isSession()).toBe(false);
    expect(tokenStore.get()).toBeNull();
  });

  it('a fresh Bearer that is still refused ends the session — no second exchange', async () => {
    seedSession(jwtFor('alice', 600));
    const calls = stubFetch((url) => {
      if (url === '/auth/token') return tokenReply(jwtFor('alice', 600) + 'x');
      if (url.startsWith('/v1/incarnations')) return { status: 401, body: { type: 'operator-revoked-token' } };
      return undefined;
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('none'));
    expect(exchanges(calls)).toBe(1);
    expect(tokenStore.isSession()).toBe(false);
    expect(tokenStore.get()).toBeNull();
  });

  it('an exchange that fails for an outage surfaces the 401 and keeps the session', async () => {
    const bearer = jwtFor('alice', 600);
    seedSession(bearer);
    stubFetch((url) => {
      if (url === '/auth/token') return { status: 503, body: { type: 'internal-error' } };
      if (url.startsWith('/v1/incarnations')) return { status: 401, body: {} };
      return undefined;
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('verifying')).toHaveTextContent('false'));
    await expect(ping()).rejects.toMatchObject({ status: 401 });
    expect(tokenStore.isSession()).toBe(true);
    expect(tokenStore.get()).toBe(bearer);
    expect(screen.getByTestId('probe')).toHaveTextContent('alice');
  });

  it('a pasted token refused at the startup ping while another tab pasted another leaves the tab signed in with that one', async () => {
    const first = jwtFor('alice', 600);
    const second = jwtFor('bob', 600);
    tokenStore.set(first);
    stubFetch((url, _m, _b, auth) => {
      if (!url.startsWith('/v1/incarnations')) return undefined;
      if (auth === `Bearer ${first}`) {
        tokenStore.set(second);
        return { status: 401, body: {} };
      }
      return PING;
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('bob'));
    expect(tokenStore.get()).toBe(second);
  });

  it('a pasted token refused with 401 is cleared, with no exchange', async () => {
    tokenStore.set(jwtFor('alice', 600));
    const calls = stubFetch((url) => (url.startsWith('/v1/incarnations') ? { status: 401, body: {} } : undefined));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('none'));
    expect(exchanges(calls)).toBe(0);
    expect(tokenStore.get()).toBeNull();
  });

  it("a session Bearer past its exp on this browser's clock is still sent: Keeper decides", async () => {
    const lapsed = jwtFor('alice', -120);
    seedSession(lapsed);
    const calls = stubFetch((url) => (url.startsWith('/v1/incarnations') ? PING : undefined));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('verifying')).toHaveTextContent('false'));
    expect(calls.find((c) => c.url.startsWith('/v1/incarnations'))?.auth).toBe(`Bearer ${lapsed}`);
    expect(exchanges(calls)).toBe(0);
  });

  it("a late exchange of alice's session does not overwrite bob's later login", async () => {
    const stale = jwtFor('alice', 600);
    seedSession(stale);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const calls = stubFetch(async (url, _m, _b, auth) => {
      if (url === '/auth/token') { await gate; return tokenReply(jwtFor('alice', 600) + 'late'); }
      if (url.startsWith('/v1/incarnations')) return auth === `Bearer ${stale}` ? { status: 401, body: {} } : PING;
      return undefined;
    });
    renderProbe();
    await waitFor(() => expect(exchanges(calls)).toBe(1));
    // Another tab: alice logs out, bob logs in.
    const bob = jwtFor('bob', 600);
    tokenStore.clear();
    tokenStore.clearSession();
    tokenStore.startSession(bob, 'local');
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'soul-stack.session' })); });
    release();
    await waitFor(() => expect(screen.getByTestId('verifying')).toHaveTextContent('false'));
    expect(tokenStore.get()).toBe(bob);
    expect(screen.getByTestId('probe')).toHaveTextContent('bob');
  });

  it('logout clears the Bearer and the session marker', async () => {
    seedSession(jwtFor('alice', 600));
    stubFetch((url) => (url.startsWith('/v1/incarnations') ? PING : undefined));
    renderProbe();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('probe-logout'));
    expect(tokenStore.isSession()).toBe(false);
    expect(tokenStore.get()).toBeNull();
  });

  it('a logout during the startup ping does not leave the app verifying', async () => {
    seedSession(jwtFor('alice', 600));
    stubFetch((url) => (url.startsWith('/v1/incarnations') ? new Promise<Reply>(() => {}) : undefined));
    renderProbe();
    expect(screen.getByTestId('verifying')).toHaveTextContent('true');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('probe-logout'));
    expect(screen.getByTestId('verifying')).toHaveTextContent('false');
    expect(screen.getByTestId('probe')).toHaveTextContent('none');
  });

  it('a logout in another tab is reflected here', async () => {
    seedSession(jwtFor('alice', 600));
    stubFetch((url) => (url.startsWith('/v1/incarnations') ? PING : undefined));
    renderProbe();
    expect(screen.getByTestId('probe')).toHaveTextContent('alice');
    tokenStore.clear();
    tokenStore.clearSession();
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'soul-stack.session' })); });
    expect(screen.getByTestId('probe')).toHaveTextContent('none');
  });
});

describe('startup restore', () => {
  // A session marker with no Bearer: what a cleared Bearer leaves.
  function seedMarkerOnly() {
    tokenStore.startSession(jwtFor('alice', 600), 'local');
    tokenStore.clear();
  }

  it('restores a session that has no Bearer', async () => {
    seedMarkerOnly();
    stubFetch((url, method) => {
      if (url === '/auth/token' && method === 'POST') return tokenReply(jwtFor('alice', 600));
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderProbe();
    expect(await screen.findByText('alice')).toBeInTheDocument();
  });

  it('an outage keeps the session for the next load; a 401 ends it', async () => {
    seedMarkerOnly();
    let release: (r: Reply) => void = () => {};
    stubFetch((url) => (url === '/auth/token' ? new Promise<Reply>((r) => { release = r; }) : undefined));
    const first = renderProbe();
    expect(screen.getByTestId('verifying')).toHaveTextContent('true');
    release({ status: 500, body: { type: 'internal-error' } });
    // verifying flips only when the exchange has settled — the 500 has landed.
    await waitFor(() => expect(screen.getByTestId('verifying')).toHaveTextContent('false'));
    expect(tokenStore.isSession()).toBe(true);
    first.unmount();

    stubFetch((url) => (url === '/auth/token' ? { status: 401, body: { type: 'unauthenticated' } } : undefined));
    renderProbe();
    await waitFor(() => expect(tokenStore.isSession()).toBe(false));
    expect(screen.getByTestId('probe')).toHaveTextContent('none');
  });

  it('a restore that hangs stops holding the page after the wait', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    seedMarkerOnly();
    stubFetch((url) => (url === '/auth/token' ? new Promise<Reply>(() => {}) : undefined));
    renderProbe();
    expect(screen.getByTestId('verifying')).toHaveTextContent('true');
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.getByTestId('verifying')).toHaveTextContent('false');
    expect(tokenStore.isSession()).toBe(true);
  });
});

describe('password login racing another tab', () => {
  it('a login whose session another tab replaced meanwhile is refused, not silently dropped', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    stubFetch(async (url) => {
      if (url === '/auth/methods') return METHODS_LOCAL;
      if (url === '/auth/local/login') return { status: 204 };
      if (url === '/auth/token') { await gate; return tokenReply(jwtFor('alice', 600)); }
      return undefined;
    });
    renderLogin();
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('login-local-login'), 'alice');
    await user.type(screen.getByTestId('login-local-password'), 'correct horse battery');
    await user.click(screen.getByTestId('login-local-submit'));
    // Another tab logs bob in while this login waits for its exchange.
    const bob = jwtFor('bob', 600);
    tokenStore.startSession(bob, 'local');
    release();
    expect(await screen.findByTestId('login-error')).toHaveTextContent(/another tab changed who is signed in/);
    expect(tokenStore.get()).toBe(bob);
    expect(screen.queryByTestId('landed')).toBeNull();
  });

  it("a login whose cookie another tab's login replaced before the exchange is refused, not stored as that Archon", async () => {
    stubFetch((url) => {
      if (url === '/auth/methods') return METHODS_LOCAL;
      if (url === '/auth/local/login') return { status: 204 };
      // Another tab logged bob in between this login and its exchange: the
      // one cookie of the browser is bob's now.
      if (url === '/auth/token') return tokenReply(jwtFor('bob', 600));
      return undefined;
    });
    renderLogin();
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('login-local-login'), ' Alice ');
    await user.type(screen.getByTestId('login-local-password'), 'correct horse battery');
    await user.click(screen.getByTestId('login-local-submit'));
    expect(await screen.findByTestId('login-error')).toHaveTextContent(/another tab changed who is signed in/);
    expect(tokenStore.isSession()).toBe(false);
    expect(tokenStore.get()).toBeNull();
  });

  it("the typed AID is compared as Keeper normalizes it, not as JavaScript lower-cases it", async () => {
    stubFetch((url) => {
      if (url === '/auth/methods') return METHODS_LOCAL;
      if (url === '/auth/local/login') return { status: 204 };
      // Keeper lower-cases U+0130 to "i": the Bearer names "admin".
      if (url === '/auth/token') return tokenReply(jwtFor('admin', 600));
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderLogin();
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('login-local-login'), 'ADM\u0130N');
    await user.type(screen.getByTestId('login-local-password'), 'correct horse battery');
    await user.click(screen.getByTestId('login-local-submit'));
    expect(await screen.findByTestId('landed')).toBeInTheDocument();
    expect(tokenStore.sessionAID()).toBe('admin');
  });

  it('the AID a Bearer names is the typed one trimmed and lower-cased', async () => {
    stubFetch((url) => {
      if (url === '/auth/methods') return METHODS_LOCAL;
      if (url === '/auth/local/login') return { status: 204 };
      if (url === '/auth/token') return tokenReply(jwtFor('alice', 600));
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderLogin();
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('login-local-login'), ' Alice ');
    await user.type(screen.getByTestId('login-local-password'), 'correct horse battery');
    await user.click(screen.getByTestId('login-local-submit'));
    expect(await screen.findByTestId('landed')).toBeInTheDocument();
    expect(tokenStore.sessionAID()).toBe('alice');
  });
});

describe('normalizeLoginAID — Keeper\'s lower(trim(aid))', () => {
  for (const [name, typed, want] of [
    ['spaces and capitals', ' Alice ', 'alice'],
    // Go's simple case mapping: U+0130 is "i", not "i" + U+0307.
    ['dotted capital I', 'ADM\u0130N', 'admin'],
    // Go trims NEL; JavaScript's trim() does not.
    ['NEL at the edges', '\u0085bob\u0085', 'bob'],
    // Go does not trim U+FEFF; Keeper then refuses the AID as typed.
    ['a leading BOM', '\ufeffcarol', '\ufeffcarol'],
  ] as const) {
    it(name, () => {
      expect(normalizeLoginAID(typed)).toBe(want);
    });
  }
});

describe('login methods that do not answer', () => {
  it('shows the token form after a short wait, and later offers the password unless a token is being typed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let answer: (r: Reply) => void = () => {};
    stubFetch((url) => (url === '/auth/methods' ? new Promise<Reply>((r) => { answer = r; }) : undefined));
    renderLogin();
    expect(screen.getByTestId('login-methods-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('login-token-input')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(screen.getByTestId('login-token-input')).toBeInTheDocument();
    answer(METHODS_LOCAL);
    expect(await screen.findByTestId('login-local-form')).toBeInTheDocument();
  });

  it('keeps the token form when a token was typed before the methods answered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let answer: (r: Reply) => void = () => {};
    stubFetch((url) => (url === '/auth/methods' ? new Promise<Reply>((r) => { answer = r; }) : undefined));
    renderLogin();
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByTestId('login-token-input'), 'eyJ');
    answer(METHODS_LOCAL);
    expect(await screen.findByTestId('login-method-local')).toBeInTheDocument();
    expect(screen.getByTestId('login-token-input')).toHaveValue('eyJ');
    expect(screen.queryByTestId('login-local-form')).toBeNull();
  });
});

describe('administration', () => {
  it('creating a local Archon sends the password and shows no JWT', async () => {
    const calls = stubFetch((url, method) => {
      if (url === '/auth/methods') return METHODS_LOCAL;
      if (url.startsWith('/v1/operators') && method === 'GET') return { status: 200, body: { items: [], offset: 0, limit: 50, total: 0 } };
      if (url === '/v1/operators' && method === 'POST') {
        return { status: 201, body: { aid: 'alice', auth_method: 'local', display_name: 'Alice', created_at: '2026-10-24T00:00:00Z', created_by_aid: 'archon-root' } };
      }
      return undefined;
    });
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/alice@corp\.com/i), 'alice');
    await user.type(screen.getByPlaceholderText(/Alice Ops/i), 'Alice');
    await user.click(await screen.findByTestId('archon-create-method-local'));
    await user.type(screen.getByTestId('archon-create-password'), 'correct horse battery');
    await user.type(screen.getByTestId('archon-create-password-repeat'), 'correct horse batter');
    expect(screen.getByRole('button', { name: /Create/i })).toBeDisabled();
    await user.type(screen.getByTestId('archon-create-password-repeat'), 'y');
    await user.click(screen.getByRole('button', { name: /Create/i }));

    expect(await screen.findByTestId('archon-created-local')).toHaveTextContent('alice');
    expect(screen.queryByText(/JWT issued/i)).toBeNull();
    const post = calls.find((c) => c.url === '/v1/operators' && c.method === 'POST');
    expect(JSON.parse(post!.body!)).toMatchObject({ aid: 'alice', auth_method: 'local', password: 'correct horse battery' });
  });

  it('without auth.local the create form has no password switch', async () => {
    stubFetch((url, method) => {
      if (url === '/auth/methods') return METHODS_NO_LOCAL;
      if (url.startsWith('/v1/operators') && method === 'GET') return { status: 200, body: { items: [], offset: 0, limit: 50, total: 0 } };
      return undefined;
    });
    const qc = renderWithClient(<ArchonsList />, '/archons');
    // The reply has landed in the cache, and the render that followed it is done.
    await waitFor(() => expect(qc.getQueryData(['auth.methods'])).toEqual(METHODS_NO_LOCAL.body));
    await act(async () => {});
    expect(screen.queryByTestId('archon-create-method-local')).toBeNull();
  });

  function operator(aid: string, method: string) {
    return {
      aid, display_name: aid, auth_method: method, created_via: 'user', created_at: '2026-10-24T00:00:00Z',
      created_by_aid: 'archon-root', revoked_at: null, bootstrap_initial: false, metadata: {},
    };
  }

  function renderCard(aid: string) {
    renderWithProviders(
      <Routes>
        <Route path="/archons/:aid" element={<ArchonDetail />} />
      </Routes>,
      `/archons/${aid}`,
    );
  }

  it('the card of a local Archon sets its password', async () => {
    const calls = stubFetch((url, method) => {
      if (url === '/v1/operators/alice' && method === 'GET') return { status: 200, body: operator('alice', 'local') };
      if (url === '/v1/operators/alice/password' && method === 'PUT') return { status: 204 };
      return undefined;
    });
    const qc = renderWithClient(
      <Routes><Route path="/archons/:aid" element={<ArchonDetail />} /></Routes>,
      '/archons/alice',
    );
    // The Tokens tab's list, read before the reset.
    qc.setQueryData(['operator.jwts', 'alice'], { items: [] });
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('archon-password-new'), 'a brand new password');
    await user.type(screen.getByTestId('archon-password-repeat'), 'a brand new password');
    await user.click(screen.getByTestId('archon-password-set'));
    expect(await screen.findByTestId('archon-password-done')).toHaveTextContent(/All web sessions and personal tokens of alice were ended/);
    const put = calls.find((c) => c.url === '/v1/operators/alice/password');
    expect(JSON.parse(put!.body!)).toEqual({ password: 'a brand new password' });
    // The reset revoked tokens that list shows as active.
    expect(qc.getQueryState(['operator.jwts', 'alice'])?.isInvalidated).toBe(true);
  });

  it('shows the Keeper refusal of a password', async () => {
    stubFetch((url, method) => {
      if (url === '/v1/operators/alice' && method === 'GET') return { status: 200, body: operator('alice', 'local') };
      if (url === '/v1/operators/alice/password') return { status: 422, body: { type: 'validation-failed', detail: 'password does not meet the policy: must be at least 12 characters' } };
      return undefined;
    });
    renderCard('alice');
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('archon-password-new'), 'short');
    await user.type(screen.getByTestId('archon-password-repeat'), 'short');
    await user.click(screen.getByTestId('archon-password-set'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 12 characters/);
  });

  it('the card of a token Archon has no Password section', async () => {
    stubFetch((url) => (url === '/v1/operators/archon-bob' ? { status: 200, body: operator('archon-bob', 'jwt') } : undefined));
    renderCard('archon-bob');
    await screen.findByRole('heading', { name: 'archon-bob' });
    expect(screen.queryByTestId('archon-password-section')).toBeNull();
  });

  it('shows the Password section to a caller holding exactly operator.set-password', async () => {
    stubFetch((url) => {
      if (url === '/v1/operators/alice') return { status: 200, body: operator('alice', 'local') };
      if (url === '/v1/me/permissions') {
        return { status: 200, body: { aid: 'helpdesk', permissions: [
          { resource: 'operator', action: 'list', wildcard: false },
          { resource: 'operator', action: 'set-password', wildcard: false },
        ] } };
      }
      return undefined;
    });
    // The section shows while permissions load (optimistic), so only its
    // presence AFTER they landed says the grant was read.
    const qc = renderWithClient(
      <Routes><Route path="/archons/:aid" element={<ArchonDetail />} /></Routes>,
      '/archons/alice',
    );
    await screen.findByRole('heading', { name: 'alice' });
    await waitFor(() => expect(qc.getQueryData(['me.permissions'])).toBeDefined());
    await act(async () => {});
    expect(screen.getByTestId('archon-password-section')).toBeInTheDocument();
  });

  // Keeper refuses one's own AID on the administrative route (it asks for no
  // current password), so the caller's own card points to the Profile instead
  // of offering a form that would fail — whatever the credential.
  for (const c of [
    { name: 'own AID on a session', viewer: 'alice', session: true, own: true },
    { name: 'own AID on a pasted token', viewer: 'alice', session: false, own: true },
    { name: "another AID's card", viewer: 'bob', session: true, own: false },
  ]) {
    it(`own card: ${c.name}`, async () => {
      const token = jwtFor(c.viewer, 600);
      if (c.session) tokenStore.startSession(token, 'local');
      else tokenStore.set(token);
      stubFetch((url) => {
        if (url === '/v1/operators/alice') return { status: 200, body: operator('alice', 'local') };
        if (url.startsWith('/v1/incarnations')) return PING;
        return undefined;
      });
      renderWithProviders(
        <AuthProvider>
          <Routes><Route path="/archons/:aid" element={<ArchonDetail />} /></Routes>
        </AuthProvider>,
        '/archons/alice',
      );
      await screen.findByTestId('archon-password-section');
      if (c.own) {
        expect(screen.getByTestId('archon-password-own')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Change my password' })).toHaveAttribute('href', '/profile/password');
        expect(screen.queryByTestId('archon-password-new')).toBeNull();
      } else {
        expect(screen.queryByTestId('archon-password-own')).toBeNull();
        expect(screen.getByTestId('archon-password-new')).toBeInTheDocument();
      }
    });
  }

  it('hides the Password section from a caller who may not set it', async () => {
    stubFetch((url) => {
      if (url === '/v1/operators/alice') return { status: 200, body: operator('alice', 'local') };
      if (url === '/v1/me/permissions') return { status: 200, body: { aid: 'viewer', permissions: [{ resource: 'operator', action: 'list', wildcard: false }] } };
      return undefined;
    });
    renderCard('alice');
    await screen.findByRole('heading', { name: 'alice' });
    await waitFor(() => expect(screen.queryByTestId('archon-password-section')).toBeNull());
  });
});

describe('raw channels and the session Bearer (round 4)', () => {
  // A WebSocket stand-in that records the subprotocols it was opened with.
  function fakeSocketImpl(opened: string[][]) {
    class FakeSocket {
      static OPEN = 1;
      static CONNECTING = 0;
      readyState = 0;
      binaryType = '';
      onopen: (() => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: ((e: CloseEvent) => void) | null = null;
      constructor(_url: string, protocols: string[]) {
        opened.push(protocols);
      }
      send() {}
      close() {}
    }
    return FakeSocket as unknown as typeof WebSocket;
  }
  const hooks = { onOpen: () => {}, onMessage: () => {}, onClose: () => {}, onError: () => {} };

  it('a session Bearer stored a moment ago opens the WebSocket as it is, with no exchange', async () => {
    const bearer = jwtFor('alice', 600);
    seedSession(bearer);
    const calls = stubFetch((url) => {
      if (url === '/auth/token') return tokenReply(jwtFor('alice', 600) + 'x');
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('verifying')).toHaveTextContent('false'));
    const opened: string[][] = [];
    createWebSocketTransport(hooks, { socketImpl: fakeSocketImpl(opened) });
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(exchanges(calls)).toBe(0);
    expect(opened[0]).toContain(`bearer.${bearer}`);
  });

  it('once half its lifetime has passed on this browser, the session Bearer is exchanged before the WebSocket opens', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const bearer = jwtFor('alice', 600);
    const fresh = jwtFor('alice', 600) + 'h';
    seedSession(bearer);
    const calls = stubFetch((url) => {
      if (url === '/auth/token') return tokenReply(fresh);
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('verifying')).toHaveTextContent('false'));
    vi.setSystemTime(Date.now() + 301_000);
    const opened: string[][] = [];
    createWebSocketTransport(hooks, { socketImpl: fakeSocketImpl(opened) });
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(exchanges(calls)).toBe(1);
    expect(opened[0]).toContain(`bearer.${fresh}`);
  });

  it('the console WebSocket of a session with a lapsed Bearer opens with a freshly exchanged one', async () => {
    const expired = jwtFor('alice', -60);
    const fresh = jwtFor('alice', 600) + 'f';
    seedSession(expired);
    const calls = stubFetch((url) => {
      if (url === '/auth/token') return tokenReply(fresh);
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('verifying')).toHaveTextContent('false'));
    const before = exchanges(calls);
    const opened: string[][] = [];
    createWebSocketTransport(hooks, { socketImpl: fakeSocketImpl(opened) });
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(exchanges(calls)).toBe(before + 1);
    expect(opened[0]).toContain(`bearer.${tokenStore.get()}`);
    expect(tokenStore.get()).not.toBe(expired);
  });

  // A socket whose handshake Keeper refuses: it closes without ever opening.
  function refusingSocketImpl(opened: string[][]) {
    class RefusedSocket {
      static OPEN = 1;
      static CONNECTING = 0;
      readyState = 0;
      binaryType = '';
      onopen: (() => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: ((e: CloseEvent) => void) | null = null;
      constructor(_url: string, protocols: string[]) {
        opened.push(protocols);
        setTimeout(() => {
          this.onerror?.();
          this.onclose?.({ code: 1006, reason: '' } as CloseEvent);
        }, 0);
      }
      send() {}
      close() {}
    }
    return RefusedSocket as unknown as typeof WebSocket;
  }

  it('a WebSocket refused with a young session Bearer ends a revoked session at once', async () => {
    seedSession(jwtFor('alice', 600));
    const calls = stubFetch((url) => {
      if (url === '/auth/token') return { status: 401, body: { type: 'unauthenticated' } };
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('verifying')).toHaveTextContent('false'));
    const opened: string[][] = [];
    createWebSocketTransport(hooks, { socketImpl: refusingSocketImpl(opened) });
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('none'));
    expect(opened).toHaveLength(1);
    expect(exchanges(calls)).toBe(1);
    expect(tokenStore.isSession()).toBe(false);
  });

  it('a refused WebSocket of a live session gets a new Bearer, and the next open uses it with no second exchange', async () => {
    const fresh = jwtFor('alice', 600) + 'r';
    seedSession(jwtFor('alice', 600));
    const calls = stubFetch((url) => {
      if (url === '/auth/token') return tokenReply(fresh);
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('verifying')).toHaveTextContent('false'));
    const refused: string[][] = [];
    createWebSocketTransport(hooks, { socketImpl: refusingSocketImpl(refused) });
    await waitFor(() => expect(tokenStore.get()).toBe(fresh));
    expect(exchanges(calls)).toBe(1);
    const opened: string[][] = [];
    createWebSocketTransport(hooks, { socketImpl: fakeSocketImpl(opened) });
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]).toContain(`bearer.${fresh}`);
    expect(exchanges(calls)).toBe(1);
  });

  // A socket that stays connecting until the page closes it.
  function connectingSocketImpl(opened: string[][]) {
    class ConnectingSocket {
      static OPEN = 1;
      static CONNECTING = 0;
      readyState = 0;
      binaryType = '';
      onopen: (() => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: ((e: CloseEvent) => void) | null = null;
      constructor(_url: string, protocols: string[]) {
        opened.push(protocols);
      }
      send() {}
      close() {
        this.onclose?.({ code: 1006, reason: '' } as CloseEvent);
      }
    }
    return ConnectingSocket as unknown as typeof WebSocket;
  }

  // A socket that opens and then drops.
  function droppingSocketImpl(opened: string[][]) {
    class DroppingSocket {
      static OPEN = 1;
      static CONNECTING = 0;
      readyState = 0;
      binaryType = '';
      onopen: (() => void) | null = null;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: ((e: CloseEvent) => void) | null = null;
      constructor(_url: string, protocols: string[]) {
        opened.push(protocols);
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.();
          this.onclose?.({ code: 1006, reason: '' } as CloseEvent);
        }, 0);
      }
      send() {}
      close() {}
    }
    return DroppingSocket as unknown as typeof WebSocket;
  }

  // What does not count as a refusal: a socket that opened, one the page closed
  // while it connected, and one opened with an explicit token.
  for (const c of [
    { name: 'a socket that opened and then dropped', impl: droppingSocketImpl, closeByPage: false, token: undefined },
    { name: 'a socket the page closed while it was connecting', impl: connectingSocketImpl, closeByPage: true, token: undefined },
    { name: 'a refused socket opened with an explicit token', impl: refusingSocketImpl, closeByPage: false, token: 'explicit' },
  ]) {
    it(`no exchange for ${c.name}`, async () => {
      const bearer = jwtFor('alice', 600);
      seedSession(bearer);
      const calls = stubFetch((url) => {
        if (url === '/auth/token') return tokenReply(jwtFor('alice', 600) + 'x');
        if (url.startsWith('/v1/incarnations')) return PING;
        return undefined;
      });
      renderProbe();
      await waitFor(() => expect(screen.getByTestId('verifying')).toHaveTextContent('false'));
      const opened: string[][] = [];
      let closedOnce = false;
      const transport = createWebSocketTransport(
        { ...hooks, onClose: () => { closedOnce = true; } },
        { socketImpl: c.impl(opened), ...(c.token === undefined ? {} : { token: c.token }) },
      );
      await waitFor(() => expect(opened).toHaveLength(1));
      if (c.closeByPage) transport.close();
      await waitFor(() => expect(closedOnce).toBe(true));
      await act(async () => {});
      expect(exchanges(calls)).toBe(0);
      expect(tokenStore.sessionBearerFresh()).toBe(true);
    });
  }

  it('a refused WebSocket whose exchange fails leaves the Bearer stale, so the next open exchanges', async () => {
    seedSession(jwtFor('alice', 600));
    const fresh = jwtFor('alice', 600) + 'n';
    let outage = true;
    const calls = stubFetch((url) => {
      if (url === '/auth/token') return outage ? { status: 503, body: { type: 'internal-error' } } : tokenReply(fresh);
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('verifying')).toHaveTextContent('false'));
    createWebSocketTransport(hooks, { socketImpl: refusingSocketImpl([]) });
    await waitFor(() => expect(exchanges(calls)).toBe(1));
    await act(async () => {});
    expect(tokenStore.isSession()).toBe(true);
    outage = false;
    const opened: string[][] = [];
    createWebSocketTransport(hooks, { socketImpl: fakeSocketImpl(opened) });
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(exchanges(calls)).toBe(2);
    expect(opened[0]).toContain(`bearer.${fresh}`);
  });

  it("a run's event stream refused for another reason than 401 spends no exchange", async () => {
    seedSession(jwtFor('alice', 600));
    const calls = stubFetch((url) => {
      if (url === '/auth/token') return tokenReply(jwtFor('alice', 600) + 'x');
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('verifying')).toHaveTextContent('false'));
    for (const status of [403, 404, 503]) {
      await subscribeRunEvents('redis', '01JAPPLY000000000000000000', {
        onEvent: () => {},
        fetchImpl: (async () => new Response(null, { status })) as typeof fetch,
      });
    }
    await act(async () => {});
    expect(exchanges(calls)).toBe(0);
  });

  it('a new session Bearer is written before its timestamp, and a new session drops the old timestamp first', () => {
    const order: string[] = [];
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string) {
      order.push(`set ${k}`);
    });
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, k: string) {
      order.push(`remove ${k}`);
    });
    try {
      tokenStore.setSessionBearer(jwtFor('alice', 600));
      expect(order).toEqual(['set soul-stack.jwt', 'set soul-stack.session-got']);
      order.length = 0;
      tokenStore.startSession(jwtFor('alice', 600), 'local');
      expect(order).toEqual([
        'remove soul-stack.session-got',
        'set soul-stack.session',
        'set soul-stack.session-method',
        'set soul-stack.session-aid',
        'set soul-stack.jwt',
        'set soul-stack.session-got',
      ]);
    } finally {
      set.mockRestore();
      remove.mockRestore();
    }
  });

  it("a run's event stream refused with 401 ends a revoked session", async () => {
    seedSession(jwtFor('alice', 600));
    const calls = stubFetch((url) => {
      if (url === '/auth/token') return { status: 401, body: { type: 'unauthenticated' } };
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('verifying')).toHaveTextContent('false'));
    await subscribeRunEvents('redis', '01JAPPLY000000000000000000', {
      onEvent: () => {},
      fetchImpl: (async () => new Response(null, { status: 401 })) as typeof fetch,
    });
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('none'));
    expect(exchanges(calls)).toBe(1);
  });

  it("a Bearer from a Keeper whose clock lags this browser's by an hour is fresh when just stored", async () => {
    const now = Math.floor(Date.now() / 1000);
    // exp is an hour behind this browser: only elapsed time may decide.
    const lagging = jwtWith('alice', now - 3600, now - 3000);
    seedSession(lagging);
    const calls = stubFetch((url) => {
      if (url === '/auth/token') return tokenReply(jwtFor('alice', 600) + 'x');
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('verifying')).toHaveTextContent('false'));
    const opened: string[][] = [];
    createWebSocketTransport(hooks, { socketImpl: fakeSocketImpl(opened) });
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(exchanges(calls)).toBe(0);
    expect(opened[0]).toContain(`bearer.${lagging}`);
  });

  it('a pasted token opens the WebSocket as stored, with no exchange', async () => {
    const pasted = jwtFor('alice', 600);
    tokenStore.set(pasted);
    const calls = stubFetch(() => undefined);
    const opened: string[][] = [];
    createWebSocketTransport(hooks, { socketImpl: fakeSocketImpl(opened) });
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(exchanges(calls)).toBe(0);
    expect(opened[0]).toContain(`bearer.${pasted}`);
  });

  it("a run's event stream of a session subscribes with a freshly exchanged Bearer", async () => {
    const expired = jwtFor('alice', -60);
    const fresh = jwtFor('alice', 600) + 'e';
    seedSession(expired);
    const calls = stubFetch((url) => {
      if (url === '/auth/token') return tokenReply(fresh);
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('verifying')).toHaveTextContent('false'));
    const before = exchanges(calls);
    const sse: string[] = [];
    await subscribeRunEvents('redis', '01JAPPLY000000000000000000', {
      onEvent: () => {},
      fetchImpl: (async (_u: RequestInfo | URL, init?: RequestInit) => {
        sse.push((init?.headers as Record<string, string>).Authorization);
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });
    expect(exchanges(calls)).toBe(before + 1);
    expect(sse).toEqual([`Bearer ${tokenStore.get()}`]);
    expect(tokenStore.get()).not.toBe(expired);
  });

  it('an exchange naming another AID ends the session instead of storing it', async () => {
    const alice = jwtFor('alice', 600);
    seedSession(alice);
    stubFetch((url, _m, _b, auth) => {
      if (url === '/auth/token') return tokenReply(jwtFor('bob', 600));
      if (url.startsWith('/v1/incarnations')) return auth === `Bearer ${alice}` ? { status: 401 } : PING;
      return undefined;
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('none'));
    expect(tokenStore.isSession()).toBe(false);
    expect(tokenStore.get()).toBeNull();
  });

  it('a 401 for a Bearer older than the stored one retries with the stored one, no exchange', async () => {
    const older = jwtFor('alice', 600);
    const newer = jwtFor('alice', 600) + 'n';
    seedSession(older);
    const calls = stubFetch((url, _m, _b, auth) => {
      if (url === '/auth/token') return tokenReply(jwtFor('alice', 600) + 'z');
      if (url.startsWith('/v1/incarnations')) return PING;
      if (url === '/v1/probe') {
        if (auth === `Bearer ${older}`) {
          // Another request exchanged meanwhile and stored a newer Bearer.
          tokenStore.setSessionBearer(newer);
          return { status: 401 };
        }
        return { status: 200, body: { ok: true } };
      }
      return undefined;
    });
    // Mounted, so an exchange is possible and its absence means something.
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('verifying')).toHaveTextContent('false'));
    const res = await apiSend<{ ok: boolean }>('/v1/probe', 'POST', { body: { n: 1 } });
    expect(res.ok).toBe(true);
    expect(exchanges(calls)).toBe(0);
    expect(calls.filter((c) => c.url === '/v1/probe').map((c) => c.auth)).toEqual([`Bearer ${older}`, `Bearer ${newer}`]);
  });

  it("a 401 that lands after another tab started bob's session is not sent again as bob, nor clears his Bearer", async () => {
    const alice = jwtFor('alice', 600);
    const bob = jwtFor('bob', 600);
    seedSession(alice);
    const calls = stubFetch((url, _m, _b, auth) => {
      if (url === '/auth/token') return tokenReply(jwtFor('bob', 600) + 'x');
      if (url.startsWith('/v1/incarnations')) return PING;
      if (url === '/v1/probe') {
        if (auth === `Bearer ${alice}`) {
          tokenStore.startSession(bob, 'local');
          return { status: 401 };
        }
        return { status: 200, body: { ok: true } };
      }
      return undefined;
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('verifying')).toHaveTextContent('false'));
    await expect(apiSend('/v1/probe', 'POST', { body: {} })).rejects.toMatchObject({ status: 401 });
    expect(calls.filter((c) => c.url === '/v1/probe').map((c) => c.auth)).toEqual([`Bearer ${alice}`]);
    expect(exchanges(calls)).toBe(0);
    expect(tokenStore.get()).toBe(bob);
    expect(tokenStore.isSession()).toBe(true);
  });

  it('a late 401 for a pasted token leaves the token another tab pasted meanwhile', async () => {
    const first = jwtFor('alice', 600);
    const second = jwtFor('alice', 600) + 's';
    tokenStore.set(first);
    stubFetch((url, _m, _b, auth) => {
      if (url === '/v1/probe' && auth === `Bearer ${first}`) {
        tokenStore.set(second);
        return { status: 401 };
      }
      return undefined;
    });
    await expect(apiSend('/v1/probe', 'POST', { body: {} })).rejects.toMatchObject({ status: 401 });
    expect(tokenStore.get()).toBe(second);
  });

  it('a retried POST goes out exactly once more, with the same method and body', async () => {
    const stale = jwtFor('alice', 600);
    const fresh = jwtFor('alice', 600) + 'p';
    seedSession(stale);
    const calls = stubFetch((url, _m, _b, auth) => {
      if (url === '/auth/token') return tokenReply(fresh);
      if (url.startsWith('/v1/incarnations')) return PING;
      if (url === '/v1/things') return auth === `Bearer ${fresh}` ? { status: 201, body: { id: 'x' } } : { status: 401 };
      return undefined;
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('verifying')).toHaveTextContent('false'));
    await apiSend('/v1/things', 'POST', { body: { name: 'one' } });
    const posts = calls.filter((c) => c.url === '/v1/things');
    expect(posts).toHaveLength(2);
    expect(posts.map((c) => c.method)).toEqual(['POST', 'POST']);
    expect(posts[0].body).toBe(JSON.stringify({ name: 'one' }));
    expect(posts[1].body).toBe(posts[0].body);
  });

  it('an exchange that never answers is abandoned and the original 401 surfaces', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const stale = jwtFor('alice', 600);
    seedSession(stale);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/auth/token') {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      if (url.startsWith('/v1/incarnations')) return new Response(JSON.stringify(PING.body), { status: 200 });
      return new Response(JSON.stringify({ title: 'refused' }), { status: 401 });
    }));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('verifying')).toHaveTextContent('false'));
    const settled = apiSend('/v1/things', 'POST', { body: {} }).then(
      () => 'ok',
      (e: { status?: number }) => e.status,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });
    expect(await settled).toBe(401);
    expect(tokenStore.isSession()).toBe(true);
  });
});

describe('profile: change my password', () => {
  function renderProfile(path = '/profile/password') {
    renderWithProviders(
      <AuthProvider>
        <Routes>
          <Route path="/profile/*" element={<ProfilePage />} />
          <Route path="/login" element={<div data-testid="on-login">login</div>} />
        </Routes>
        <Probe />
      </AuthProvider>,
      path,
    );
  }
  const operator = (method: string) => ({ status: 200, body: { aid: 'alice', auth_method: method, display_name: 'alice', created_at: '2026-10-24T00:00:00Z', created_via: 'user', bootstrap_initial: false } });
  const myJwts = { status: 200, body: { items: [], offset: 0, limit: 1, total: 0, personal_active: 0, personal_limit: 10, personal_last_day: 0, personal_daily_limit: 20 } };

  it('a local Archon gets the Password section', async () => {
    tokenStore.set(jwtFor('alice', 600));
    stubFetch((url) => {
      if (url === '/v1/operators/alice') return operator('local');
      if (url.startsWith('/v1/me/jwts')) return myJwts;
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderProfile();
    expect(await screen.findByTestId('my-password')).toBeInTheDocument();
  });

  it('a token Archon has no Password section', async () => {
    tokenStore.set(jwtFor('alice', 600));
    stubFetch((url) => {
      if (url === '/v1/operators/alice') return operator('jwt');
      if (url.startsWith('/v1/me/jwts')) return myJwts;
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    // The Password link is held until the record answers, so landing on Tokens
    // means the record said "not local".
    renderProfile();
    expect(await screen.findByTestId('issue-jwt-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('my-password')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Password' })).toBeNull();
  });

  it('without operator.list a password session still gets the section', async () => {
    seedSession(jwtFor('alice', 600));
    stubFetch((url) => {
      if (url === '/v1/operators/alice') return { status: 403, body: { title: 'forbidden' } };
      if (url.startsWith('/v1/me/jwts')) return myJwts;
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderProfile();
    expect(await screen.findByTestId('my-password')).toBeInTheDocument();
  });

  it('a link straight to Password says it is loading while the operator record is on its way', async () => {
    tokenStore.set(jwtFor('alice', 600));
    stubFetch((url) => {
      if (url === '/v1/operators/alice') return new Promise<Reply>(() => {});
      if (url.startsWith('/v1/me/jwts')) return myJwts;
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderProfile();
    expect(await screen.findByTestId('profile-section-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('my-password')).toBeNull();
  });

  it('a wrong current password says so and does not sign out', async () => {
    const user = userEvent.setup();
    seedSession(jwtFor('alice', 600));
    stubFetch((url, method) => {
      if (url === '/v1/operators/alice') return operator('local');
      if (url === '/v1/me/password' && method === 'PUT') return { status: 403, body: { title: 'Forbidden', detail: 'current password is incorrect' } };
      if (url.startsWith('/v1/me/jwts')) return myJwts;
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderProfile();
    await user.type(await screen.findByTestId('my-password-current'), 'not it');
    await user.type(screen.getByTestId('my-password-new'), 'a brand new password');
    await user.type(screen.getByTestId('my-password-repeat'), 'a brand new password');
    await user.click(screen.getByTestId('my-password-submit'));
    expect(await screen.findByTestId('my-password-error')).toHaveTextContent('The current password is incorrect.');
    expect(screen.getByTestId('probe')).toHaveTextContent('alice');
    expect(tokenStore.isSession()).toBe(true);
    expect(screen.queryByTestId('on-login')).toBeNull();
  });

  it('a successful change says what ended and what stays', async () => {
    const user = userEvent.setup();
    seedSession(jwtFor('alice', 600));
    const calls = stubFetch((url, method) => {
      if (url === '/v1/operators/alice') return operator('local');
      if (url === '/v1/me/password' && method === 'PUT') return { status: 204 };
      if (url.startsWith('/v1/me/jwts')) return myJwts;
      if (url.startsWith('/v1/incarnations')) return PING;
      return undefined;
    });
    renderProfile();
    await user.type(await screen.findByTestId('my-password-current'), 'correct horse battery');
    await user.type(screen.getByTestId('my-password-new'), 'a brand new password');
    await user.type(screen.getByTestId('my-password-repeat'), 'a brand new password');
    await user.click(screen.getByTestId('my-password-submit'));
    expect(await screen.findByTestId('my-password-done')).toHaveTextContent('Your other web sessions were ended');
    const put = calls.find((c) => c.url === '/v1/me/password');
    expect(JSON.parse(put!.body!)).toEqual({ current_password: 'correct horse battery', new_password: 'a brand new password' });
  });
});
