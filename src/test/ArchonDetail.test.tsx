import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { ArchonDetail } from '../pages/archons/ArchonDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

function withParamRoute() {
  return (
    <Routes>
      <Route path="/archons/:aid" element={<ArchonDetail />} />
    </Routes>
  );
}

describe('ArchonDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  it('renders an active Archon profile', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/operators/archon-alice',
        body: {
          aid: 'archon-alice',
          display_name: 'Alice Ops',
          auth_method: 'jwt',
          created_via: 'user',
          created_at: '2026-05-10T10:00:00Z',
          created_by_aid: 'archon-bootstrap',
          revoked_at: null,
          bootstrap_initial: false,
          metadata: { team: 'platform' },
        },
      },
    ]);
    renderWithProviders(withParamRoute(), '/archons/archon-alice');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument();
    });
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('archon-bootstrap')).toBeInTheDocument();
    // Metadata JsonViewer.
    expect(screen.getByText(/platform/)).toBeInTheDocument();
    // created_via badge -- stable match via data-testid
    expect(screen.getByTestId('created-via-archon-alice')).toHaveTextContent('user');
  });

  it('shows revoked + bootstrap initial badges', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/operators/archon-bootstrap',
        body: {
          aid: 'archon-bootstrap',
          display_name: 'Bootstrap',
          auth_method: 'jwt',
          created_via: 'bootstrap',
          created_at: '2026-05-01T00:00:00Z',
          created_by_aid: null,
          revoked_at: '2026-05-20T00:00:00Z',
          bootstrap_initial: true,
          metadata: {},
        },
      },
    ]);
    renderWithProviders(withParamRoute(), '/archons/archon-bootstrap');
    await waitFor(() => {
      expect(screen.getByText('revoked')).toBeInTheDocument();
    });
    // "bootstrap initial" -- badge in the header (Info tab is active by default;
    // the "Bootstrap initial" string in meta -- different case).
    expect(screen.getAllByText(/bootstrap initial/i).length).toBeGreaterThanOrEqual(1);
    // empty metadata → placeholder.
    expect(screen.getByText(/metadata is empty/i)).toBeInTheDocument();
  });

  // -- Guard tests: created_via badge --------------------------------------

  it.each([
    ['oidc', 'archon-oidc'],
    ['system', 'archon-system'],
  ] as const)('created_via=%s is shown in the Badge by data-testid', async (createdVia, aid) => {
    installFetchMock([
      {
        method: 'GET',
        url: `/v1/operators/${aid}`,
        body: {
          aid,
          display_name: `${createdVia} Archon`,
          auth_method: 'jwt',
          created_via: createdVia,
          created_at: '2026-06-01T00:00:00Z',
          created_by_aid: 'archon-bootstrap',
          revoked_at: null,
          bootstrap_initial: false,
          metadata: {},
        },
      },
    ]);
    renderWithProviders(withParamRoute(), `/archons/${aid}`);
    await waitFor(() => {
      expect(screen.getByTestId(`created-via-${aid}`)).toHaveTextContent(createdVia);
    });
  });

  it('created_via=null/undefined → shows «—» in the badge cell', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/operators/archon-no-via',
        body: {
          aid: 'archon-no-via',
          display_name: 'No Via',
          auth_method: 'jwt',
          created_via: null,
          created_at: '2026-06-01T00:00:00Z',
          created_by_aid: 'archon-bootstrap',
          revoked_at: null,
          bootstrap_initial: false,
          metadata: {},
        },
      },
    ]);
    renderWithProviders(withParamRoute(), '/archons/archon-no-via');
    await waitFor(() => {
      expect(screen.getByTestId('created-via-archon-no-via')).toHaveTextContent('—');
    });
  });

  it('Revoke button is absent for an already-revoked Archon', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/operators/archon-old',
        body: {
          aid: 'archon-old',
          display_name: 'Old',
          auth_method: 'jwt',
          created_via: 'user',
          created_at: '2026-04-01T00:00:00Z',
          created_by_aid: 'archon-bootstrap',
          revoked_at: '2026-05-20T00:00:00Z',
          bootstrap_initial: false,
          metadata: {},
        },
      },
    ]);
    renderWithProviders(withParamRoute(), '/archons/archon-old');
    await waitFor(() => {
      expect(screen.getByText('revoked')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /^Revoke$/ })).not.toBeInTheDocument();
  });

  it('Revoke flow: click Revoke → Modal → POST /v1/operators/archon-alice/revoke', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const detailBody = {
      aid: 'archon-alice',
      display_name: 'Alice',
      auth_method: 'jwt',
      created_via: 'user',
      created_at: '2026-05-10T10:00:00Z',
      created_by_aid: 'archon-bootstrap',
      revoked_at: null,
      bootstrap_initial: false,
      metadata: {},
    };
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url, method });
      if (url === '/v1/operators/archon-alice' && method === 'GET') {
        return new Response(JSON.stringify(detailBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/v1/operators/archon-alice/revoke' && method === 'POST') {
        return new Response('', { status: 204 });
      }
      return new Response('{}', { status: 599 });
    });

    renderWithProviders(withParamRoute(), '/archons/archon-alice');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Alice/i })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId('revoke-archon'));
    expect(await screen.findByRole('dialog', { name: /Revoke archon-alice/i })).toBeInTheDocument();
    await user.click(screen.getByTestId('revoke-submit'));
    await waitFor(() => {
      expect(calls.some((c) => c.url === '/v1/operators/archon-alice/revoke' && c.method === 'POST')).toBe(true);
    });
  });

  // -- Guard tests: role assignment and revocation ---------------------------

  // Base data for role tests
  const ALICE_OP = {
    aid: 'archon-alice',
    display_name: 'Alice Ops',
    auth_method: 'jwt',
    created_via: 'user',
    created_at: '2026-05-10T10:00:00Z',
    created_by_aid: 'archon-bootstrap',
    revoked_at: null,
    bootstrap_initial: false,
    metadata: {},
  };

  const ROLES_WITH_ALICE = {
    items: [
      { name: 'cluster-admin', description: '', builtin: true, permissions: ['*'], operators: ['archon-alice'] },
      { name: 'soul-operator', description: '', builtin: false, permissions: ['soul.list'], operators: [] },
    ],
  };

  const ROLES_NO_ALICE = {
    items: [
      { name: 'cluster-admin', description: '', builtin: true, permissions: ['*'], operators: [] },
      { name: 'soul-operator', description: '', builtin: false, permissions: ['soul.list'], operators: [] },
    ],
  };

  // Flexible mock recording calls for role tests
  function roleRecordingFetch(opts: {
    op: typeof ALICE_OP;
    roles: typeof ROLES_WITH_ALICE;
    grantStatus?: number;
    revokeStatus?: number;
    revokeType?: string;
    revokeDetail?: string;
  }): { calls: Array<{ url: string; method: string; body: string | null }> } {
    const calls: Array<{ url: string; method: string; body: string | null }> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : null;
      calls.push({ url, method, body });

      if (url.startsWith('/v1/operators/') && method === 'GET') {
        return new Response(JSON.stringify(opts.op), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.startsWith('/v1/roles') && method === 'GET') {
        return new Response(JSON.stringify(opts.roles), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (/\/v1\/roles\/[^/]+\/operators$/.test(url) && method === 'POST') {
        const status = opts.grantStatus ?? 204;
        // jsdom does not accept an empty body for 204, use 200 with an empty body in the mock
        return new Response(null, { status });
      }
      if (/\/v1\/roles\/[^/]+\/operators\/[^/]+$/.test(url) && method === 'DELETE') {
        const status = opts.revokeStatus ?? 204;
        if (status !== 204) {
          return new Response(
            JSON.stringify({ type: opts.revokeType ?? 'about:blank', status, detail: opts.revokeDetail ?? 'error' }),
            { status, headers: { 'Content-Type': 'application/problem+json' } },
          );
        }
        return new Response(null, { status: 204 });
      }
      return new Response('{}', { status: 599 });
    });
    return { calls };
  }

  it('Guard: «Assign role» button opens AssignRoleModal with the correct aid', async () => {
    roleRecordingFetch({ op: ALICE_OP, roles: ROLES_WITH_ALICE });
    renderWithProviders(withParamRoute(), '/archons/archon-alice');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument();
    });

    const assignBtn = await screen.findByTestId('assign-role-btn');
    const user = userEvent.setup();
    await user.click(assignBtn);

    // Modal opened with the current archon's aid
    const dialog = await screen.findByRole('dialog', { name: /Assign role: archon-alice/i });
    expect(dialog).toBeInTheDocument();
  });

  it('Guard: successful role assignment calls POST /v1/roles/{name}/operators and closes the modal', async () => {
    const { calls } = roleRecordingFetch({ op: ALICE_OP, roles: ROLES_NO_ALICE });
    renderWithProviders(withParamRoute(), '/archons/archon-alice');

    await waitFor(() => expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument());

    const user = userEvent.setup();
    const assignBtn = await screen.findByTestId('assign-role-btn');
    await user.click(assignBtn);

    const dialog = await screen.findByRole('dialog', { name: /Assign role: archon-alice/i });
    await user.selectOptions(dialog.querySelector('select')!, 'soul-operator');
    await user.click(screen.getByRole('button', { name: /^Assign$/ }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url === '/v1/roles/soul-operator/operators');
      expect(post).toBeDefined();
      expect(post!.body).toContain('archon-alice');
    });
    // Modal closes after success (invalidateQueries has run)
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Assign role/i })).not.toBeInTheDocument();
    });
  });

  it('Guard: «×» button next to a role calls revokeOperator(role, aid) + refetch', async () => {
    // window.confirm auto-confirmed
    vi.stubGlobal('confirm', () => true);
    const { calls } = roleRecordingFetch({ op: ALICE_OP, roles: ROLES_WITH_ALICE });
    renderWithProviders(withParamRoute(), '/archons/archon-alice');

    await waitFor(() => expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument());

    // Wait for the role chip to appear
    const revokeBtn = await screen.findByRole('button', { name: /unassign role cluster-admin/i });
    const user = userEvent.setup();
    await user.click(revokeBtn);

    await waitFor(() => {
      const del = calls.find(
        (c) => c.method === 'DELETE' && c.url === '/v1/roles/cluster-admin/operators/archon-alice',
      );
      expect(del).toBeDefined();
    });
    // No error -- inline-error is not shown
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Guard: 409 lockout → inline error is visible, role does NOT disappear from the list', async () => {
    vi.stubGlobal('confirm', () => true);
    roleRecordingFetch({
      op: ALICE_OP,
      roles: ROLES_WITH_ALICE,
      revokeStatus: 409,
      revokeType: 'https://soul-stack.io/errors/would-lock-out-cluster',
      revokeDetail: 'last cluster-admin cannot be removed',
    });
    renderWithProviders(withParamRoute(), '/archons/archon-alice');

    await waitFor(() => expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument());

    const revokeBtn = await screen.findByRole('button', { name: /unassign role cluster-admin/i });
    const user = userEvent.setup();
    await user.click(revokeBtn);

    // Inline error appears
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/lock-?out|self-lockout|admin/i);

    // Role is still in the DOM (did not disappear)
    expect(screen.getByRole('button', { name: /unassign role cluster-admin/i })).toBeInTheDocument();
  });

  it('Guard: 403 on role removal → clear error message', async () => {
    vi.stubGlobal('confirm', () => true);
    roleRecordingFetch({
      op: ALICE_OP,
      roles: ROLES_WITH_ALICE,
      revokeStatus: 403,
      revokeDetail: 'forbidden',
    });
    renderWithProviders(withParamRoute(), '/archons/archon-alice');

    await waitFor(() => expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument());

    const revokeBtn = await screen.findByRole('button', { name: /unassign role cluster-admin/i });
    const user = userEvent.setup();
    await user.click(revokeBtn);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/insufficient permissions|forbidden/i);
  });

  it('Activity tab shows a link to /audit?archon_aid=<aid>', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/operators/archon-alice',
        body: {
          aid: 'archon-alice',
          display_name: 'Alice',
          auth_method: 'jwt',
          created_via: 'user',
          created_at: '2026-05-10T10:00:00Z',
          created_by_aid: 'archon-bootstrap',
          revoked_at: null,
          bootstrap_initial: false,
          metadata: {},
        },
      },
    ]);
    renderWithProviders(withParamRoute(), '/archons/archon-alice');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Alice/i })).toBeInTheDocument();
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Activity/i }));
    const link = screen.getByRole('link', { name: /Open Audit/i });
    expect(link).toHaveAttribute('href', '/audit?archon_aid=archon-alice');
  });

  // -- Guard tests: Synods section --------------------------------------------

  const SYNODS_WITH_ALICE = {
    items: [
      { name: 'ops-team', description: 'Ops group', builtin: false, roles: ['soul-operator'], operators: ['archon-alice'] },
      { name: 'admins', description: '', builtin: true, roles: ['cluster-admin'], operators: ['archon-alice', 'archon-bob'] },
      { name: 'dev-team', description: '', builtin: false, roles: [], operators: ['archon-bob'] },
    ],
  };

  const SYNODS_NO_ALICE = {
    items: [
      { name: 'ops-team', description: '', builtin: false, roles: [], operators: ['archon-bob'] },
      { name: 'dev-team', description: '', builtin: false, roles: [], operators: [] },
    ],
  };

  function synodFetch(op: typeof ALICE_OP, synods: typeof SYNODS_WITH_ALICE) {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.startsWith('/v1/operators/') && method === 'GET') {
        return new Response(JSON.stringify(op), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.startsWith('/v1/roles') && method === 'GET') {
        return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === '/v1/synods' && method === 'GET') {
        return new Response(JSON.stringify(synods), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 599 });
    });
  }

  it('Guard: member synods are shown in the section, non-members are not', async () => {
    synodFetch(ALICE_OP, SYNODS_WITH_ALICE);
    renderWithProviders(withParamRoute(), '/archons/archon-alice');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument();
    });

    // Synods section is visible
    const section = await screen.findByRole('region', { name: /synods/i });
    expect(section).toBeInTheDocument();

    // archon-alice -- member of ops-team and admins
    expect(await screen.findByRole('link', { name: /ops-team/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /admins/i })).toBeInTheDocument();

    // dev-team -- alice is not a member, should not appear
    expect(screen.queryByRole('link', { name: /dev-team/i })).not.toBeInTheDocument();
  });

  it('Guard: synod links point to /synods/:name', async () => {
    synodFetch(ALICE_OP, SYNODS_WITH_ALICE);
    renderWithProviders(withParamRoute(), '/archons/archon-alice');

    const link = await screen.findByRole('link', { name: /ops-team/i });
    expect(link).toHaveAttribute('href', '/synods/ops-team');
  });

  it('Guard: empty-state when the archon is not in any group', async () => {
    synodFetch(ALICE_OP, SYNODS_NO_ALICE);
    renderWithProviders(withParamRoute(), '/archons/archon-alice');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument();
    });

    // Wait until synods finish loading and the empty-state appears
    await waitFor(() => {
      expect(screen.getByText(/is not a member of any group/i)).toBeInTheDocument();
    });
    // No links to synods
    expect(screen.queryByRole('link', { name: /ops-team/i })).not.toBeInTheDocument();
  });

  // -- Guard tests: role links --------------------------------------------------

  it('[LINKS] archon roles render as links to /rbac', async () => {
    roleRecordingFetch({ op: ALICE_OP, roles: ROLES_WITH_ALICE });
    renderWithProviders(withParamRoute(), '/archons/archon-alice');

    await waitFor(() => expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument());

    // Wait for the roles section to appear -- archon-alice is a member of cluster-admin
    const link = await screen.findByRole('link', { name: 'cluster-admin' });
    expect(link).toHaveAttribute('href', '/rbac');
  });

  it('[LINKS] with no roles there are no links in the roles section', async () => {
    roleRecordingFetch({ op: ALICE_OP, roles: ROLES_NO_ALICE });
    renderWithProviders(withParamRoute(), '/archons/archon-alice');

    await waitFor(() => expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument());

    // Wait for roles to load (the section stops being loading)
    await waitFor(() => {
      const section = screen.getByRole('region', { name: /^roles$/i });
      expect(section).not.toHaveTextContent(/Loading/i);
    });

    // None of the roles are assigned to alice -- no links to /rbac
    const rbacLinks = screen.queryAllByRole('link', { name: /cluster-admin|soul-operator/i });
    expect(rbacLinks).toHaveLength(0);
  });
});
