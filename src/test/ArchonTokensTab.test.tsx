import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { AuthProvider } from '../hooks/AuthProvider';
import { ArchonDetail } from '../pages/archons/ArchonDetail';
import { tokenStore } from '../api/tokenStore';

const ALICE = {
  aid: 'alice',
  display_name: 'Alice',
  auth_method: 'jwt',
  created_via: 'user',
  created_at: '2026-05-10T10:00:00Z',
  created_by_aid: 'archon-root',
  revoked_at: null,
  bootstrap_initial: false,
};

const SESSION_ROW = {
  jwt_id: '01JSESS10NR0W0000000000000',
  aid: 'alice',
  kind: 'session',
  created_at: '2026-10-24T20:58:00Z',
  expires_at: '2099-10-25T20:58:00Z',
};

function mock(permissions: { resource: string; action: string; wildcard?: boolean }[]) {
  const calls: { method: string; url: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ method, url });
      const json = (status: number, body?: unknown) =>
        new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.startsWith('/v1/operators/alice/jwts/') && method === 'POST') return json(204);
      if (url.startsWith('/v1/operators/alice/jwts')) return json(200, { items: [SESSION_ROW], offset: 0, limit: 50, total: 1 });
      if (url.startsWith('/v1/operators/alice')) return json(200, ALICE);
      if (url.startsWith('/v1/me/permissions')) return json(200, { permissions });
      if (url.startsWith('/v1/roles') || url.startsWith('/v1/synods')) return json(200, { items: [] });
      if (url.startsWith('/v1/incarnations')) return json(200, { items: [], offset: 0, limit: 1, total: 0 });
      return json(599, { title: 'not mocked', detail: url });
    }),
  );
  return calls;
}

function renderCard() {
  return renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route path="/archons/:aid" element={<ArchonDetail />} />
        <Route path="/login" element={<div data-testid="login-page" />} />
      </Routes>
    </AuthProvider>,
    '/archons/alice',
  );
}

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
}

describe('Operator card → Tokens', () => {
  beforeEach(() => {
    tokenStore.clear();
    tokenStore.set('a.eyJzdWIiOiJhcmNob24tcm9vdCJ9.s');
  });

  it('lists every kind of the operator’s tokens, sign-ins included, and revokes one', async () => {
    const calls = mock([{ resource: 'operator', action: 'jwt-revoke' }, { resource: 'operator', action: 'list' }]);
    renderCard();
    await userEvent.click(await screen.findByTestId('archon-tab-tokens'));
    expect(await screen.findByTestId(`jwt-row-${SESSION_ROW.jwt_id}`)).toBeInTheDocument();
    const list = calls.find((c) => c.url.startsWith('/v1/operators/alice/jwts'))!;
    expect(new URLSearchParams(list.url.split('?')[1]).getAll('kind')).toEqual(['personal', 'issued', 'session', 'bootstrap']);

    await userEvent.click(screen.getByTestId(`jwt-revoke-${SESSION_ROW.jwt_id}`));
    expect(screen.queryByTestId('jwt-revoke-current-warn')).toBeNull();
    await userEvent.click(screen.getByTestId('jwt-revoke-confirm'));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url === `/v1/operators/alice/jwts/${SESSION_ROW.jwt_id}/revoke`)).toBe(true),
    );
    // Someone else's token: the administrator stays signed in.
    await waitFor(() => expect(screen.queryByTestId('jwt-revoke-confirm')).toBeNull());
    expect(screen.queryByTestId('login-page')).toBeNull();
    expect(tokenStore.get()).not.toBeNull();
  });

  it('an administrator revoking their own sign-in on their own card is signed out', async () => {
    tokenStore.set(fakeJwt({ sub: 'alice', jti: SESSION_ROW.jwt_id, exp: 4102444800 }));
    mock([{ resource: '*', action: '*', wildcard: true }]);
    renderCard();
    await userEvent.click(await screen.findByTestId('archon-tab-tokens'));
    await userEvent.click(await screen.findByTestId(`jwt-revoke-${SESSION_ROW.jwt_id}`));
    expect(screen.getByTestId('jwt-revoke-current-warn')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('jwt-revoke-confirm'));
    expect(await screen.findByTestId('login-page')).toBeInTheDocument();
    expect(tokenStore.get()).toBeNull();
  });

  it('without operator.jwt-revoke there is no revoke button', async () => {
    mock([{ resource: 'operator', action: 'list' }]);
    renderCard();
    await userEvent.click(await screen.findByTestId('archon-tab-tokens'));
    expect(await screen.findByTestId(`jwt-row-${SESSION_ROW.jwt_id}`)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId(`jwt-revoke-${SESSION_ROW.jwt_id}`)).toBeNull());
  });
});
