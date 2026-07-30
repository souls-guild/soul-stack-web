import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { MembersSection } from '../pages/incarnations/MembersSection';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

// Roster UI over the NIM-209 membership endpoints. The invariants under guard:
// a missing bound_by_aid never renders as "undefined", the destructive control
// is hidden by RIGHT rather than by the server's answer, and a scope-narrowed or
// forbidden roster reads as an explanation instead of an error.

const ROSTER = {
  items: [
    {
      sid: 'host-a.local',
      status: 'connected',
      bound_at: '2026-07-28T10:00:00Z',
      bound_by_aid: 'archon-ops',
    },
    // No bound_by_aid — a row written by a scenario, not by an operator.
    { sid: 'host-b.local', status: 'disconnected', bound_at: '2026-07-28T11:00:00Z' },
  ],
  offset: 0,
  limit: 2,
  total: 2,
};

function permissions(perms: Array<{ resource: string; action: string }>) {
  return { permissions: perms.map((p) => ({ ...p, wildcard: false })) };
}

const ALL_PERMS = permissions([
  { resource: 'incarnation', action: 'get' },
  { resource: 'incarnation', action: 'bind-member' },
  { resource: 'incarnation', action: 'unbind-member' },
]);

describe('MembersSection', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('renders the roster; a member without bound_by_aid shows a dash, never "undefined"', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/me/permissions', body: ALL_PERMS },
      { method: 'GET', url: '/v1/incarnations/redis-prod/members', body: ROSTER },
    ]);
    renderWithProviders(<MembersSection incarnationName="redis-prod" />);

    await waitFor(() => expect(screen.getByTestId('members-table')).toBeInTheDocument());
    expect(screen.getByText('host-a.local')).toBeInTheDocument();
    expect(screen.getByText('archon-ops')).toBeInTheDocument();
    const rowB = screen.getByText('host-b.local').closest('tr')!;
    expect(rowB.textContent).toContain('—');
    expect(rowB.textContent).not.toContain('undefined');
  });

  it('hides both actions when the rights are absent', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/me/permissions', body: permissions([{ resource: 'incarnation', action: 'get' }]) },
      { method: 'GET', url: '/v1/incarnations/redis-prod/members', body: ROSTER },
    ]);
    renderWithProviders(<MembersSection incarnationName="redis-prod" />);

    await waitFor(() => expect(screen.getByTestId('members-table')).toBeInTheDocument());
    expect(screen.queryByTestId('bind-members-open')).not.toBeInTheDocument();
    expect(screen.queryByTestId('unbind-member-host-a.local')).not.toBeInTheDocument();
  });

  // Unbind is the destructive half and carries a right of its own: holding
  // bind-member must not surface the unbind control.
  it('bind-member alone does not surface the unbind control', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/me/permissions',
        body: permissions([
          { resource: 'incarnation', action: 'get' },
          { resource: 'incarnation', action: 'bind-member' },
        ]),
      },
      { method: 'GET', url: '/v1/incarnations/redis-prod/members', body: ROSTER },
    ]);
    renderWithProviders(<MembersSection incarnationName="redis-prod" />);

    await waitFor(() => expect(screen.getByTestId('bind-members-open')).toBeInTheDocument());
    expect(screen.queryByTestId('unbind-member-host-a.local')).not.toBeInTheDocument();
  });

  it('403 on the roster degrades to an explanation, not a raw error', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/me/permissions', body: ALL_PERMS },
      {
        method: 'GET',
        url: '/v1/incarnations/redis-prod/members',
        status: 403,
        body: { title: 'forbidden', detail: 'permission incarnation.get required' },
      },
    ]);
    renderWithProviders(<MembersSection incarnationName="redis-prod" />);

    await waitFor(() => expect(screen.getByTestId('members-forbidden')).toBeInTheDocument());
    expect(screen.getByTestId('members-forbidden').textContent).toMatch(/incarnation\.get/);
  });

  // An empty roster is a legitimate answer for a scope-narrowed operator, so the
  // empty state must say so rather than claim the incarnation has no hosts.
  it('empty roster explains the scope narrowing', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/me/permissions', body: ALL_PERMS },
      {
        method: 'GET',
        url: '/v1/incarnations/redis-prod/members',
        body: { items: [], offset: 0, limit: 0, total: 0 },
      },
    ]);
    renderWithProviders(<MembersSection incarnationName="redis-prod" />);

    await waitFor(() => expect(screen.getByTestId('members-empty')).toBeInTheDocument());
    expect(screen.getByTestId('members-empty').textContent).toMatch(/scope/i);
  });

  it('a null items list does not crash the section', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/me/permissions', body: ALL_PERMS },
      {
        method: 'GET',
        url: '/v1/incarnations/redis-prod/members',
        body: { items: null, offset: 0, limit: 0, total: 0 },
      },
    ]);
    renderWithProviders(<MembersSection incarnationName="redis-prod" />);

    await waitFor(() => expect(screen.getByTestId('members-empty')).toBeInTheDocument());
  });

  it('unbind: confirmation is required, then DELETE hits the member route', async () => {
    let deleteUrl = '';
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'DELETE') {
        deleteUrl = url;
        return new Response('', { status: 204 });
      }
      const body = url.includes('/me/permissions') ? ALL_PERMS : ROSTER;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(<MembersSection incarnationName="redis-prod" />);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('unbind-member-host-a.local')).toBeInTheDocument());
    await user.click(screen.getByTestId('unbind-member-host-a.local'));

    const confirm = screen.getByTestId('unbind-member-confirm');
    expect(confirm).toBeDisabled();
    expect(screen.getByTestId('unbind-member-warning').textContent).toMatch(/future run/i);

    await user.click(screen.getByLabelText('Confirm unbinding the host'));
    expect(confirm).not.toBeDisabled();
    await user.click(confirm);

    await waitFor(() => {
      expect(deleteUrl).toMatch(/\/v1\/incarnations\/redis-prod\/members\/host-a\.local$/);
    });
  });

  it('unbind 403 on soul scope shows the host-boundary reason', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'DELETE') {
        return new Response(
          JSON.stringify({
            title: 'forbidden',
            detail: "SID host-a.local is outside the operator's soul scope",
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const body = url.includes('/me/permissions') ? ALL_PERMS : ROSTER;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(<MembersSection incarnationName="redis-prod" />);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('unbind-member-host-a.local')).toBeInTheDocument());
    await user.click(screen.getByTestId('unbind-member-host-a.local'));
    await user.click(screen.getByLabelText('Confirm unbinding the host'));
    await user.click(screen.getByTestId('unbind-member-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('members-unbind-error').textContent).toMatch(/soul scope/i);
    });
  });
});
