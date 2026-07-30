import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { BindMembersModal } from '../pages/incarnations/BindMembersModal';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

// The bind picker. Two properties are load-bearing: only CONNECTED souls are
// offered (anything else is a guaranteed 422), and the idempotent reply is
// reported as two numbers, not one.

const SOULS = {
  items: [
    { sid: 'host-a.local', transport: 'agent', status: 'connected', covens: ['prod'], registered_at: '2026-07-01T00:00:00Z' },
    { sid: 'host-b.local', transport: 'agent', status: 'connected', covens: [], registered_at: '2026-07-01T00:00:00Z' },
  ],
  offset: 0,
  limit: 500,
  total: 2,
};

describe('BindMembersModal', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('asks the registry for connected souls only', async () => {
    let soulsUrl = '';
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('/v1/souls')) soulsUrl = url;
      return new Response(JSON.stringify(SOULS), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(
      <BindMembersModal open incarnationName="redis-prod" memberSids={[]} onClose={() => {}} onBound={() => {}} />,
    );
    await waitFor(() => expect(soulsUrl).toMatch(/status=connected/));
  });

  it('excludes hosts already on the roster', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/souls', body: SOULS }]);
    renderWithProviders(
      <BindMembersModal
        open
        incarnationName="redis-prod"
        memberSids={['host-a.local']}
        onClose={() => {}}
        onBound={() => {}}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('bind-members-search'));

    await waitFor(() => expect(screen.getByTestId('bind-members-option-host-b.local')).toBeInTheDocument());
    expect(screen.queryByTestId('bind-members-option-host-a.local')).not.toBeInTheDocument();
  });

  it('POSTs the selected SIDs and reports both halves of the reply', async () => {
    let body: unknown = null;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST') {
        body = init?.body ? JSON.parse(init.body as string) : null;
        return new Response(
          JSON.stringify({
            incarnation: 'redis-prod',
            bound: ['host-a.local'],
            already_member: ['host-b.local'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(url.startsWith('/v1/souls') ? SOULS : {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const bound: unknown[] = [];
    renderWithProviders(
      <BindMembersModal
        open
        incarnationName="redis-prod"
        memberSids={[]}
        onClose={() => {}}
        onBound={(o) => bound.push(o)}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('bind-members-search'));
    await waitFor(() => screen.getByTestId('bind-members-option-host-a.local'));
    await user.click(screen.getByTestId('bind-members-option-host-a.local'));
    await user.click(screen.getByTestId('bind-members-option-host-b.local'));
    await user.click(screen.getByTestId('bind-members-confirm'));

    await waitFor(() => expect(body).toEqual({ sids: ['host-a.local', 'host-b.local'] }));
    await waitFor(() =>
      expect(bound).toEqual([{ bound: ['host-a.local'], alreadyMember: ['host-b.local'] }]),
    );
  });

  // Both reply lists are nullable on the wire; the modal must hand a usable
  // outcome to its caller instead of propagating null.
  it('a reply with null lists yields empty halves, not a crash', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
        return new Response(
          JSON.stringify({ incarnation: 'redis-prod', bound: null, already_member: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(url.startsWith('/v1/souls') ? SOULS : {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const bound: unknown[] = [];
    renderWithProviders(
      <BindMembersModal
        open
        incarnationName="redis-prod"
        memberSids={[]}
        onClose={() => {}}
        onBound={(o) => bound.push(o)}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('bind-members-search'));
    await waitFor(() => screen.getByTestId('bind-members-option-host-a.local'));
    await user.click(screen.getByTestId('bind-members-option-host-a.local'));
    await user.click(screen.getByTestId('bind-members-confirm'));

    await waitFor(() => expect(bound).toEqual([{ bound: [], alreadyMember: [] }]));
  });

  it('403 on the per-host gate says the whole batch was rejected', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
        return new Response(
          JSON.stringify({
            title: 'forbidden',
            detail: "SID(s) outside the operator's soul scope: host-b.local",
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(url.startsWith('/v1/souls') ? SOULS : {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(
      <BindMembersModal open incarnationName="redis-prod" memberSids={[]} onClose={() => {}} onBound={() => {}} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('bind-members-search'));
    await waitFor(() => screen.getByTestId('bind-members-option-host-a.local'));
    await user.click(screen.getByTestId('bind-members-option-host-a.local'));
    await user.click(screen.getByTestId('bind-members-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('bind-members-error').textContent).toMatch(
        /none of the selected hosts were bound/i,
      );
    });
  });

  it('submit is disabled until something is selected', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/souls', body: SOULS }]);
    renderWithProviders(
      <BindMembersModal open incarnationName="redis-prod" memberSids={[]} onClose={() => {}} onBound={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId('bind-members-confirm')).toBeDisabled());
  });
});
