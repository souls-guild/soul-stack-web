import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { MembersPanel } from '../pages/incarnations/MembersPanel';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

// The roster half of the merged panel (NIM-232 over the NIM-209 endpoints,
// merged with the vitals table in NIM-444). The invariants under guard: a
// missing bound_by_aid never renders as "undefined", the destructive control is
// hidden by RIGHT rather than by the server's answer, and a scope-narrowed or
// forbidden roster reads as an explanation instead of an error.
//
// The vitals columns of the same table are guarded in MembersPanelVitals.test.tsx.

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

// The roster is the row source; telemetry only fills columns. These fixtures
// answer it with nothing so the table is pure membership.
const NO_TELEMETRY = { incarnation: 'redis-prod', truncated: false, hosts: [] };

function permissions(perms: Array<{ resource: string; action: string }>) {
  return { permissions: perms.map((p) => ({ ...p, wildcard: false })) };
}

const ALL_PERMS = permissions([
  { resource: 'incarnation', action: 'get' },
  { resource: 'incarnation', action: 'bind-member' },
  { resource: 'incarnation', action: 'unbind-member' },
]);

function render() {
  renderWithProviders(<MembersPanel incarnationName="redis-prod" />);
}

describe('MembersPanel — roster', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('renders the roster; a member without bound_by_aid shows a dash, never "undefined"', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/me/permissions', body: ALL_PERMS },
      { method: 'GET', url: '/v1/incarnations/redis-prod/members', body: ROSTER },
      { method: 'GET', url: '/v1/incarnations/redis-prod/telemetry', body: NO_TELEMETRY },
    ]);
    render();

    await waitFor(() => expect(screen.getByTestId('members-table')).toBeInTheDocument());
    expect(screen.getByText('host-a.local')).toBeInTheDocument();
    expect(screen.getByText('host-b.local')).toBeInTheDocument();
    // Provenance moved into the row expansion when the two tables became one.
    await userEvent.setup().click(screen.getByLabelText('Show details for host host-b.local'));
    const facts = await screen.findByTestId('member-facts');
    expect(facts.textContent).toContain('—');
    expect(facts.textContent).not.toContain('undefined');
  });

  it('the operator who bound a host is on that host row, not on another', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/me/permissions', body: ALL_PERMS },
      { method: 'GET', url: '/v1/incarnations/redis-prod/members', body: ROSTER },
      { method: 'GET', url: '/v1/incarnations/redis-prod/telemetry', body: NO_TELEMETRY },
    ]);
    render();

    await waitFor(() => expect(screen.getByTestId('members-table')).toBeInTheDocument());
    await userEvent.setup().click(screen.getByLabelText('Show details for host host-a.local'));
    expect((await screen.findByTestId('member-facts')).textContent).toContain('archon-ops');
  });

  it('hides both actions when the rights are absent', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/me/permissions', body: permissions([{ resource: 'incarnation', action: 'get' }]) },
      { method: 'GET', url: '/v1/incarnations/redis-prod/members', body: ROSTER },
      { method: 'GET', url: '/v1/incarnations/redis-prod/telemetry', body: NO_TELEMETRY },
    ]);
    render();

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
      { method: 'GET', url: '/v1/incarnations/redis-prod/telemetry', body: NO_TELEMETRY },
    ]);
    render();

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
      { method: 'GET', url: '/v1/incarnations/redis-prod/telemetry', body: NO_TELEMETRY },
    ]);
    render();

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
      { method: 'GET', url: '/v1/incarnations/redis-prod/telemetry', body: NO_TELEMETRY },
    ]);
    render();

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
      { method: 'GET', url: '/v1/incarnations/redis-prod/telemetry', body: NO_TELEMETRY },
    ]);
    render();

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
      const body = url.includes('/me/permissions')
        ? ALL_PERMS
        : url.includes('/telemetry')
          ? NO_TELEMETRY
          : ROSTER;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('unbind-member-host-a.local')).toBeInTheDocument());
    await user.click(screen.getByTestId('unbind-member-host-a.local'));

    const confirm = screen.getByTestId('unbind-member-confirm');
    expect(confirm).toBeDisabled();
    // Both halves of the warning: the lead-in comes from its own key, so a
    // missing one would render as the bare key name rather than fail loudly.
    expect(screen.getByTestId('unbind-member-warning').textContent).toMatch(/Dangerous operation/i);
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
      const body = url.includes('/me/permissions')
        ? ALL_PERMS
        : url.includes('/telemetry')
          ? NO_TELEMETRY
          : ROSTER;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render();
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
