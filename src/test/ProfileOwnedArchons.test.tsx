import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { AuthProvider } from '../hooks/AuthProvider';
import { ProfilePage } from '../pages/profile/ProfilePage';
import { tokenStore } from '../api/tokenStore';

const JWT_ID = '01JSDGATEWAY00000000000000';

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
}

function owned(over: Record<string, unknown>) {
  return {
    aid: 'sd-gateway',
    display_name: 'SD gateway',
    auth_method: 'jwt',
    created_via: 'user',
    created_at: '2026-10-01T00:00:00Z',
    created_by_aid: 'root',
    owner_aid: 'alice',
    ...over,
  };
}

const TOKEN = {
  jwt_id: JWT_ID,
  aid: 'sd-gateway',
  kind: 'issued',
  label: 'prod',
  created_at: '2026-10-01T00:00:00Z',
  expires_at: '2099-01-01T00:00:00Z',
  created_by_aid: 'root',
};

interface Call {
  method: string;
  url: string;
  body?: unknown;
}
type Reply = { status: number; body?: unknown };

const LACKS = {
  status: 403,
  body: {
    type: 'https://soul-stack.com/errors/owner-lacks-permissions',
    title: 'Forbidden',
    status: 403,
    detail: 'you own this operator but do not hold every permission it holds; missing: soul.read',
  },
};

function mockKeeper(opts: { operators?: unknown[]; issue?: Reply; revoke?: Reply } = {}) {
  const calls: Call[] = [];
  const operators = opts.operators ?? [owned({})];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = ({ status, body }: Reply) =>
        new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.startsWith('/v1/incarnations')) return json({ status: 200, body: { items: [], offset: 0, limit: 1, total: 0 } });
      if (method === 'GET' && (url === '/v1/me/operators' || url.startsWith('/v1/me/operators?'))) {
        return json({ status: 200, body: { items: operators, offset: 0, limit: 50, total: operators.length } });
      }
      if (method === 'GET' && /^\/v1\/me\/operators\/[^/]+\/jwts/.test(url)) {
        return json({ status: 200, body: { items: [TOKEN], offset: 0, limit: 50, total: 1 } });
      }
      if (method === 'POST' && url === '/v1/me/operators/sd-gateway/jwts') {
        return json(
          opts.issue ?? {
            status: 201,
            body: { aid: 'sd-gateway', jwt: 'eyJ.owned.tok', jwt_id: '01JNEW0WNED000000000000000', expires_at: '2027-01-24T00:00:00Z' },
          },
        );
      }
      if (method === 'POST' && url === `/v1/me/operators/sd-gateway/jwts/${JWT_ID}/revoke`) return json(opts.revoke ?? { status: 204 });
      return json({ status: 599, body: { title: 'not mocked', detail: url } });
    }),
  );
  return calls;
}

function renderProfile(path = '/profile/owned') {
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

describe('Profile → Owned Archons', () => {
  beforeEach(() => {
    tokenStore.clear();
    tokenStore.set(fakeJwt({ sub: 'alice', jti: '01JSESS10N0000000000000000', exp: 4102444800 }));
  });

  it('is a Profile tab listing GET /v1/me/operators, with the tokens of a single one shown', async () => {
    const calls = mockKeeper();
    renderProfile('/profile/tokens');
    await userEvent.click(await screen.findByRole('link', { name: 'Owned Archons' }));
    expect(await screen.findByTestId('owned-sd-gateway')).toHaveTextContent('SD gateway');
    expect(await screen.findByTestId(`jwt-row-${JWT_ID}`)).toBeInTheDocument();
    const list = calls.find((c) => c.method === 'GET' && c.url.startsWith('/v1/me/operators/sd-gateway/jwts'))!;
    expect(new URLSearchParams(list.url.split('?')[1]).get('state')).toBe('active');
  });

  it('several owned Archons start collapsed; one owned through a Synod says so', async () => {
    const calls = mockKeeper({ operators: [owned({}), owned({ aid: 'sd-dict', display_name: 'SD dictionary', owner_aid: undefined, owner_synod: 'dba' })] });
    renderProfile();
    expect(await screen.findByTestId('owned-sd-dict')).toHaveTextContent('through Synod dba');
    expect(screen.queryByTestId('jwt-list')).toBeNull();
    await userEvent.click(screen.getByTestId('owned-toggle-sd-gateway'));
    expect(await screen.findByTestId(`jwt-row-${JWT_ID}`)).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith('/v1/me/operators/sd-dict/jwts'))).toBe(false);
  });

  it('issues a token of an owned Archon: 201, shown once, 90 days by default', async () => {
    const calls = mockKeeper();
    renderProfile();
    await userEvent.click(await screen.findByTestId('owned-issue-sd-gateway'));
    expect(screen.getByTestId('issue-jwt-preset-90d')).toBeChecked();
    await userEvent.type(screen.getByTestId('issue-jwt-label'), 'rotation');
    await userEvent.click(screen.getByTestId('issue-jwt-submit'));
    expect(await screen.findByTestId('issued-jwt')).toHaveTextContent('eyJ.owned.tok');
    expect(calls.find((c) => c.method === 'POST' && c.url === '/v1/me/operators/sd-gateway/jwts')?.body).toEqual({
      label: 'rotation',
      ttl: '90d',
    });
  });

  it('403 owner-lacks-permissions on issue says what it means and names the missing permission', async () => {
    mockKeeper({ issue: LACKS });
    renderProfile();
    await userEvent.click(await screen.findByTestId('owned-issue-sd-gateway'));
    await userEvent.click(screen.getByTestId('issue-jwt-submit'));
    const err = await screen.findByTestId('issue-jwt-error');
    expect(err).toHaveTextContent('You own this Archon but do not hold every permission it holds');
    expect(err).toHaveTextContent('missing: soul.read');
    expect(screen.queryByTestId('issued-jwt')).toBeNull();
  });

  it('revokes a token of an owned Archon through /v1/me/operators', async () => {
    const calls = mockKeeper();
    renderProfile();
    await userEvent.click(await screen.findByTestId(`jwt-revoke-${JWT_ID}`));
    await userEvent.click(screen.getByTestId('jwt-revoke-confirm'));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url === `/v1/me/operators/sd-gateway/jwts/${JWT_ID}/revoke`)).toBe(true),
    );
    expect(screen.queryByTestId('login-page')).toBeNull();
  });

  it('409 jwt-already-revoked on revoke is shown in the confirm', async () => {
    mockKeeper({
      revoke: {
        status: 409,
        body: { type: 'https://soul-stack.com/errors/jwt-already-revoked', title: 'JWT is already revoked', status: 409, detail: `jwt ${JWT_ID} is already revoked` },
      },
    });
    renderProfile();
    await userEvent.click(await screen.findByTestId(`jwt-revoke-${JWT_ID}`));
    await userEvent.click(screen.getByTestId('jwt-revoke-confirm'));
    expect(await screen.findByTestId('jwt-revoke-error')).toHaveTextContent('is already revoked');
  });

  it('403 personal-jwt-from-personal says to sign in instead', async () => {
    mockKeeper({
      issue: {
        status: 403,
        body: { type: 'https://soul-stack.com/errors/personal-jwt-from-personal', title: 'Forbidden', status: 403, detail: 'a personal token cannot mint one' },
      },
    });
    renderProfile();
    await userEvent.click(await screen.findByTestId('owned-issue-sd-gateway'));
    await userEvent.click(screen.getByTestId('issue-jwt-submit'));
    expect(await screen.findByTestId('issue-jwt-error')).toHaveTextContent('signed in with a personal token');
  });

  it('owning nothing explains how ownership comes about', async () => {
    mockKeeper({ operators: [] });
    renderProfile();
    expect(await screen.findByTestId('owned-empty')).toHaveTextContent('An administrator can make you the owner');
  });
});
