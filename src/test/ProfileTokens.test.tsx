import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { AuthProvider } from '../hooks/AuthProvider';
import { ProfilePage } from '../pages/profile/ProfilePage';
import { Topbar } from '../components/layout/Topbar';
import { tokenStore } from '../api/tokenStore';

// A JWT the browser is signed in with: sub alice, jti SESSION (no signature check
// happens client-side).
const SESSION = '01JSESS10N0000000000000000';
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
}

function row(over: Record<string, unknown>) {
  return {
    jwt_id: '01JPERS0NA10000000000000AA',
    aid: 'alice',
    kind: 'personal',
    label: 'backup script',
    created_at: '2026-10-24T21:12:00Z',
    expires_at: '2099-01-22T21:12:00Z',
    created_by_aid: 'alice',
    created_ip: '10.15.4.21',
    created_user_agent: 'curl/8.5',
    last_used_at: '2026-10-24T21:40:00Z',
    last_used_ip: '10.15.9.7',
    ...over,
  };
}

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

function mockKeeper(opts: { items?: unknown[]; active?: number; limit?: number; ttlMax?: number; lastDay?: number; expiresBy?: string } = {}) {
  const calls: Call[] = [];
  const items = opts.items ?? [row({})];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = (status: number, body?: unknown) =>
        new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.startsWith('/v1/incarnations')) return json(200, { items: [], offset: 0, limit: 1, total: 0 });
      if (method === 'GET' && url.startsWith('/v1/me/jwts')) {
        return json(200, {
          items,
          offset: 0,
          limit: 50,
          total: items.length,
          personal_ttl_max_seconds: opts.ttlMax ?? 90 * 86400,
          personal_active: opts.active ?? 1,
          personal_limit: opts.limit ?? 10,
          personal_last_day: opts.lastDay ?? 1,
          personal_daily_limit: 20,
          ...(opts.expiresBy ? { personal_expires_by: opts.expiresBy } : {}),
        });
      }
      if (method === 'POST' && url === '/v1/me/jwts') {
        return json(201, { aid: 'alice', jwt: 'eyJ.personal.tok', jwt_id: '01JNEWPERS0NA1000000000000', expires_at: '2026-10-25T21:12:00Z' });
      }
      if (method === 'POST' && /^\/v1\/me\/jwts\/[^/]+\/revoke$/.test(url)) return json(204);
      return json(599, { title: 'not mocked', detail: url });
    }),
  );
  return calls;
}

function renderProfile(path = '/profile/tokens') {
  return renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route path="/profile/*" element={<ProfilePage />} />
        <Route path="/login" element={<div data-testid="login-page" />} />
      </Routes>
    </AuthProvider>,
    path,
  );
}

describe('Profile → Tokens', () => {
  beforeEach(() => {
    tokenStore.clear();
    tokenStore.set(fakeJwt({ sub: 'alice', jti: SESSION, exp: 4102444800 }));
  });

  it('lists the caller’s non-session tokens, active first, from /v1/me/jwts', async () => {
    const calls = mockKeeper();
    renderProfile('/profile');
    expect(await screen.findByTestId('jwt-row-01JPERS0NA10000000000000AA')).toBeInTheDocument();
    const list = calls.find((c) => c.method === 'GET' && c.url.startsWith('/v1/me/jwts') && c.url.includes('limit=50'));
    expect(list).toBeDefined();
    const qs = new URLSearchParams(list!.url.split('?')[1]);
    expect(qs.getAll('kind')).toEqual(['personal', 'issued', 'bootstrap']);
    expect(qs.get('state')).toBe('active');
    expect(screen.getByTestId('personal-count')).toHaveTextContent('1 of 10');
  });

  it('kind and state filters go to the server', async () => {
    const calls = mockKeeper();
    renderProfile();
    await screen.findByTestId('jwt-list');
    await userEvent.click(screen.getByTestId('jwt-filter-kind-issued'));
    await userEvent.click(screen.getByTestId('jwt-filter-state-revoked'));
    await waitFor(() => {
      const last = calls.filter((c) => c.url.includes('limit=50')).at(-1)!;
      const qs = new URLSearchParams(last.url.split('?')[1]);
      expect(qs.getAll('kind')).toEqual(['issued']);
      expect(qs.get('state')).toBe('revoked');
    });
  });

  it('issues a personal token and shows it once; lifetimes above the ceiling are not offered', async () => {
    const calls = mockKeeper({ ttlMax: 86400 });
    renderProfile();
    await userEvent.click(await screen.findByTestId('issue-jwt-btn'));
    expect(screen.getByTestId('issue-jwt-preset-7d')).toBeDisabled();
    expect(screen.getByTestId('issue-jwt-preset-1d')).toBeChecked();
    await userEvent.type(screen.getByTestId('issue-jwt-label'), 'ci smoke');
    await userEvent.click(screen.getByTestId('issue-jwt-submit'));
    expect(await screen.findByTestId('issued-jwt')).toHaveTextContent('eyJ.personal.tok');
    const post = calls.find((c) => c.method === 'POST' && c.url === '/v1/me/jwts');
    expect(post?.body).toEqual({ label: 'ci smoke', ttl: '1d' });
  });

  it('a custom lifetime above the ceiling is refused before the request', async () => {
    const calls = mockKeeper({ ttlMax: 86400 });
    renderProfile();
    await userEvent.click(await screen.findByTestId('issue-jwt-btn'));
    await userEvent.click(screen.getByTestId('issue-jwt-preset-custom'));
    await userEvent.type(screen.getByTestId('issue-jwt-custom'), '2d');
    await userEvent.click(screen.getByTestId('issue-jwt-submit'));
    expect(await screen.findByText(/Longer than allowed for you \(1d\)/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url === '/v1/me/jwts')).toBe(false);
  });

  it('at the limit the issue button is disabled', async () => {
    mockKeeper({ active: 10, limit: 10 });
    renderProfile();
    expect(await screen.findByTestId('personal-at-limit')).toBeInTheDocument();
    expect(screen.getByTestId('issue-jwt-btn')).toBeDisabled();
  });

  it('with both limits reached the daily one is shown: a revoke would not help', async () => {
    mockKeeper({ active: 10, limit: 10, lastDay: 20 });
    renderProfile();
    expect(await screen.findByTestId('personal-at-limit')).toHaveTextContent('last 24 hours');
  });

  it('after 20 issued in a day the issue button is disabled, active slots or not', async () => {
    mockKeeper({ active: 2, lastDay: 20 });
    renderProfile();
    expect(await screen.findByTestId('personal-at-limit')).toHaveTextContent('last 24 hours');
    expect(screen.getByTestId('issue-jwt-btn')).toBeDisabled();
  });

  it('an OIDC sign-in says when the token will expire at the latest', async () => {
    mockKeeper({ ttlMax: 86400, expiresBy: '2026-10-25T09:30:00Z' });
    renderProfile();
    await userEvent.click(await screen.findByTestId('issue-jwt-btn'));
    expect(screen.getByTestId('issue-jwt-expires-by')).toHaveTextContent('2026-10-25 09:30');
  });

  it('counts a label in characters, as the server does', async () => {
    const calls = mockKeeper();
    renderProfile();
    await userEvent.click(await screen.findByTestId('issue-jwt-btn'));
    // 150 astral characters are 300 UTF-16 code units, and 150 characters.
    const label = '\u{1F511}'.repeat(150);
    const input = screen.getByTestId('issue-jwt-label') as HTMLInputElement;
    await userEvent.click(input);
    await userEvent.paste(label);
    await userEvent.click(screen.getByTestId('issue-jwt-submit'));
    await screen.findByTestId('issued-jwt');
    expect(calls.find((c) => c.method === 'POST' && c.url === '/v1/me/jwts')?.body).toMatchObject({ label });
  });

  it('revokes one of your own tokens through /v1/me', async () => {
    const calls = mockKeeper();
    renderProfile();
    await userEvent.click(await screen.findByTestId('jwt-revoke-01JPERS0NA10000000000000AA'));
    expect(screen.queryByTestId('jwt-revoke-current-warn')).toBeNull();
    await userEvent.click(screen.getByTestId('jwt-revoke-confirm'));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url === '/v1/me/jwts/01JPERS0NA10000000000000AA/revoke')).toBe(true),
    );
  });

  it('the token this browser is signed in with is marked, and revoking it signs out', async () => {
    mockKeeper({ items: [row({ jwt_id: SESSION, kind: 'issued', label: 'my login' })] });
    renderProfile();
    const current = await screen.findByTestId(`jwt-row-${SESSION}`);
    expect(within(current).getByText('this sign-in')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(`jwt-revoke-${SESSION}`));
    expect(screen.getByTestId('jwt-revoke-current-warn')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('jwt-revoke-confirm'));
    expect(await screen.findByTestId('login-page')).toBeInTheDocument();
    expect(tokenStore.get()).toBeNull();
  });
});

describe('Topbar → Profile', () => {
  beforeEach(() => {
    tokenStore.clear();
    tokenStore.set(fakeJwt({ sub: 'alice', jti: SESSION, exp: 4102444800 }));
  });

  it('the AID menu opens the profile', async () => {
    mockKeeper();
    renderWithProviders(
      <AuthProvider>
        <Topbar />
        <Routes>
          <Route path="/profile/*" element={<div data-testid="profile-page" />} />
          <Route path="*" element={null} />
        </Routes>
      </AuthProvider>,
      '/overview',
    );
    await userEvent.click(screen.getByRole('button', { name: /alice/ }));
    await userEvent.click(screen.getByTestId('topbar-profile-link'));
    expect(await screen.findByTestId('profile-page')).toBeInTheDocument();
  });
});
