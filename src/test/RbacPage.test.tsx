import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { RbacPage } from '../pages/rbac/RbacPage';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const SAMPLE = {
  items: [
    {
      name: 'cluster-admin',
      description: 'Full permissions',
      builtin: true,
      permissions: ['*'],
      operators: ['archon-bootstrap', 'archon-alice'],
    },
    {
      name: 'soul-operator',
      description: 'Manage Souls',
      builtin: false,
      permissions: ['soul.list', 'soul.read', 'soul.exec'],
      operators: ['archon-alice'],
    },
  ],
};

const PERMISSIONS_SAMPLE = {
  items: [
    {
      resource: 'soul',
      actions: [
        { action: 'list', selector_keys: ['coven', 'sid'] },
        { action: 'read', selector_keys: ['coven', 'sid'] },
        { action: 'exec', selector_keys: ['coven', 'sid'] },
      ],
    },
    {
      resource: 'incarnation',
      actions: [
        { action: 'list', selector_keys: [] },
        { action: 'read', selector_keys: [] },
        { action: 'run', selector_keys: [] },
      ],
    },
    {
      resource: 'audit',
      actions: [{ action: 'read', selector_keys: [] }],
    },
  ],
};

const OPERATORS_SAMPLE = {
  items: [
    { aid: 'archon-bootstrap', display_name: 'Boot', auth_method: 'jwt', created_at: '2026-05-01', created_by_aid: null, revoked_at: null, bootstrap_initial: true },
    { aid: 'archon-alice', display_name: 'Alice', auth_method: 'jwt', created_at: '2026-05-10', created_by_aid: 'archon-bootstrap', revoked_at: null, bootstrap_initial: false },
    { aid: 'archon-bob', display_name: 'Bob', auth_method: 'jwt', created_at: '2026-05-15', created_by_aid: 'archon-bootstrap', revoked_at: null, bootstrap_initial: false },
  ],
  offset: 0,
  limit: 200,
  total: 3,
};

interface Call {
  url: string;
  method: string;
  body: string | null;
}

// Flexible fetch-mock recording calls for CRUD checks. installFetchMock
// is more convenient for plain reads, but here we need to separate GET/POST/PATCH/DELETE
// on the same paths and log the body.
function recordingFetch(opts: {
  rolesList: typeof SAMPLE;
  operators?: typeof OPERATORS_SAMPLE;
  permissions?: typeof PERMISSIONS_SAMPLE;
  // Conflict simulator: if url == path and method == method -- return status and detail.
  conflict?: { path: RegExp; method: string; status: number; type?: string; detail?: string };
}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : null;
    calls.push({ url, method, body });

    if (opts.conflict && opts.conflict.path.test(url) && method === opts.conflict.method) {
      return new Response(
        JSON.stringify({
          type: opts.conflict.type ?? 'about:blank',
          title: 'Conflict',
          status: opts.conflict.status,
          detail: opts.conflict.detail ?? 'conflict',
        }),
        { status: opts.conflict.status, headers: { 'Content-Type': 'application/problem+json' } },
      );
    }

    if (url.startsWith('/v1/permissions') && method === 'GET') {
      return new Response(JSON.stringify(opts.permissions ?? PERMISSIONS_SAMPLE), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    // Autocomplete endpoints for scope-builder (graceful empty if not needed).
    if (url.startsWith('/v1/incarnations') && method === 'GET') {
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 20, total: 0 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('/v1/services') && method === 'GET') {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('/v1/souls') && method === 'GET') {
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 200, total: 0 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('/v1/roles') && method === 'GET') {
      return new Response(JSON.stringify(opts.rolesList), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('/v1/operators') && method === 'GET') {
      return new Response(JSON.stringify(opts.operators ?? OPERATORS_SAMPLE), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    // CRUD on roles -- all 204 with no body.
    if (url === '/v1/roles' && method === 'POST') return new Response('', { status: 201 });
    if (/^\/v1\/roles\/[^/]+$/.test(url) && method === 'DELETE') return new Response('', { status: 204 });
    if (/^\/v1\/roles\/[^/]+\/permissions$/.test(url) && method === 'PATCH') return new Response('', { status: 204 });
    if (/^\/v1\/roles\/[^/]+\/operators$/.test(url) && method === 'POST') return new Response('', { status: 204 });
    if (/^\/v1\/roles\/[^/]+\/operators\/[^/]+$/.test(url) && method === 'DELETE') return new Response('', { status: 204 });

    return new Response('{}', { status: 599 });
  });
  return calls;
}

describe('RbacPage', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  it('renders role list from /v1/roles', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/roles', body: SAMPLE }]);
    renderWithProviders(<RbacPage />, '/rbac');
    expect(screen.getByRole('heading', { name: /RBAC/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('cluster-admin')).toBeInTheDocument();
      expect(screen.getByText('soul-operator')).toBeInTheDocument();
    });
  });

  // NIM-182 / ADR-078: derivation is visible in the catalog — a role bounded by another
  // one, and what it actually grants once that parent is applied.
  it('shows parent_role and the resolved set of a derived role', async () => {
    const derived = {
      items: [
        ...SAMPLE.items,
        {
          name: 'soul-operator-web',
          description: 'web tier only',
          builtin: false,
          permissions: ['soul.list', 'soul.read'],
          operators: [] as string[],
          parent_role: 'soul-operator',
          effective_permissions: ['soul.list on trait.tier=web'],
        },
      ],
    };
    installFetchMock([{ method: 'GET', url: '/v1/roles', body: derived }]);
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();

    const parentCell = await screen.findByTestId('role-parent-soul-operator-web');
    expect(parentCell).toHaveTextContent('soul-operator');
    // 2 stored rows resolve to 1 — the counts differ, so both are shown.
    expect(parentCell.closest('tr')).toHaveTextContent('2 → 1');

    await user.click(screen.getByRole('tab', { name: /Role permissions/i }));
    const effective = await screen.findByTestId('role-effective-soul-operator-web');
    expect(effective).toHaveTextContent('soul.list on trait.tier=web');
    expect(screen.getByTestId('role-derived-badge-soul-operator-web')).toHaveTextContent(
      /derived from soul-operator/i,
    );
  });

  it('switching to Role permissions shows permission chips', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/roles', body: SAMPLE }]);
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /Role permissions/i }));
    await waitFor(() => {
      expect(screen.getByText('soul.list')).toBeInTheDocument();
      expect(screen.getByText('soul.exec')).toBeInTheDocument();
    });
  });

  it('Archon assignments groups roles by AID', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/roles', body: SAMPLE },
      { method: 'GET', url: '/v1/operators', body: OPERATORS_SAMPLE },
    ]);
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /Archon assignments/i }));
    await waitFor(() => {
      expect(screen.getByText('archon-alice')).toBeInTheDocument();
      expect(screen.getByText('archon-bootstrap')).toBeInTheDocument();
    });
  });

  it('empty-state on empty response', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/roles', body: { items: [] } }]);
    renderWithProviders(<RbacPage />, '/rbac');
    await waitFor(() => {
      expect(screen.getByText(/No roles in the cluster/i)).toBeInTheDocument();
    });
  });

  it('«Create role» navigates to dedicated route /rbac/roles/new (NIM-80), not a modal', async () => {
    // Role creation was moved to a separate page (CreateRolePage.test.tsx
    // covers the form itself). RbacPage only navigates.
    recordingFetch({ rolesList: SAMPLE });
    renderWithProviders(
      <Routes>
        <Route path="/rbac" element={<RbacPage />} />
        <Route path="/rbac/roles/new" element={<div>CREATE-ROLE-PAGE</div>} />
      </Routes>,
      '/rbac',
    );
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Create role/i }));
    await waitFor(() => expect(screen.getByText('CREATE-ROLE-PAGE')).toBeInTheDocument());
    expect(screen.queryByRole('dialog', { name: /Create role/i })).not.toBeInTheDocument();
  });

  it('Edit permissions: navigates to dedicated page /rbac/roles/{name}/edit (NIM-128), not a modal', async () => {
    // Permission editing moved from a modal to a full page (RoleEditPage.test.tsx
    // covers the edit form itself). RbacPage only navigates.
    recordingFetch({ rolesList: SAMPLE });
    renderWithProviders(
      <Routes>
        <Route path="/rbac" element={<RbacPage />} />
        <Route path="/rbac/roles/:name/edit" element={<div>ROLE-EDIT-PAGE</div>} />
      </Routes>,
      '/rbac',
    );
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('soul-operator')).toBeInTheDocument());

    // Edit button next to soul-operator (second table row).
    const editButtons = screen.getAllByRole('button', { name: /edit permissions/i });
    await user.click(editButtons[1]);
    await waitFor(() => expect(screen.getByText('ROLE-EDIT-PAGE')).toBeInTheDocument());
    expect(screen.queryByRole('dialog', { name: /Permissions:/i })).not.toBeInTheDocument();
  });

  it('Delete role: confirm-modal → DELETE /v1/roles/{name}', async () => {
    const calls = recordingFetch({ rolesList: SAMPLE });
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('soul-operator')).toBeInTheDocument());

    // Delete on soul-operator (non-builtin); cluster-admin disabled.
    const deleteButtons = screen.getAllByRole('button', { name: /delete role/i });
    // deleteButtons[0] — cluster-admin (builtin, disabled), [1] — soul-operator.
    expect(deleteButtons[0]).toBeDisabled();
    await user.click(deleteButtons[1]);

    const dialog = await screen.findByRole('dialog', { name: /Delete role: soul-operator/i });
    // Operators who will lose permissions are visible.
    expect(within(dialog).getByText(/will lose/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /^Delete$/ }));

    await waitFor(() => {
      const del = calls.find((c) => c.url === '/v1/roles/soul-operator' && c.method === 'DELETE');
      expect(del).toBeDefined();
    });
  });

  it('Delete role 409 would-lock-out-cluster → self-lockout pretty-error', async () => {
    recordingFetch({
      rolesList: SAMPLE,
      conflict: {
        path: /\/v1\/roles\/soul-operator$/,
        method: 'DELETE',
        status: 409,
        type: 'https://soul-stack.io/errors/would-lock-out-cluster',
        detail: 'last cluster-admin',
      },
    });
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('soul-operator')).toBeInTheDocument());

    const deleteButtons = screen.getAllByRole('button', { name: /delete role/i });
    await user.click(deleteButtons[1]);
    const dialog = await screen.findByRole('dialog', { name: /Delete role: soul-operator/i });
    await user.click(within(dialog).getByRole('button', { name: /^Delete$/ }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(/lock-?out|self-lockout|admin/i);
    // Modal doesn't close -- dialog is still in DOM.
    expect(screen.getByRole('dialog', { name: /Delete role: soul-operator/i })).toBeInTheDocument();
  });

  it('Assign role: POST /v1/roles/{name}/operators with {aid}', async () => {
    const calls = recordingFetch({ rolesList: SAMPLE });
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /Archon assignments/i }));
    // Wait for archon-bob (who has no roles) to appear.
    await waitFor(() => expect(screen.getByText('archon-bob')).toBeInTheDocument());

    const assignButtons = screen.getAllByRole('button', { name: /assign role/i });
    // archon-alice, archon-bob, archon-bootstrap -- 3 buttons; pick archon-bob.
    const bobBtn = assignButtons.find((b) => b.getAttribute('aria-label') === 'assign role archon-bob');
    await user.click(bobBtn!);

    const dialog = await screen.findByRole('dialog', { name: /Assign role: archon-bob/i });
    await user.selectOptions(within(dialog).getByLabelText('role'), 'soul-operator');
    await user.click(within(dialog).getByRole('button', { name: /^Assign$/ }));

    await waitFor(() => {
      const post = calls.find(
        (c) => c.method === 'POST' && c.url === '/v1/roles/soul-operator/operators',
      );
      expect(post).toBeDefined();
      expect(post!.body).toContain('archon-bob');
    });
  });

  it('Revoke role (× on chip): DELETE /v1/roles/{name}/operators/{aid}', async () => {
    const calls = recordingFetch({ rolesList: SAMPLE });
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /Archon assignments/i }));
    await waitFor(() => expect(screen.getByText('archon-alice')).toBeInTheDocument());

    // Remove archon-alice from soul-operator. The chip with x has aria-label
    // "remove archon-alice from role soul-operator".
    const x = screen.getByRole('button', { name: /unassign archon-alice from role soul-operator/i });
    await user.click(x);

    await waitFor(() => {
      const del = calls.find(
        (c) => c.method === 'DELETE' && c.url === '/v1/roles/soul-operator/operators/archon-alice',
      );
      expect(del).toBeDefined();
    });
  });

  // -- Guard tests: clickable links --------------------------------------------

  it('[LINKS] AIDs in Archon assignments render as links to /archons/:aid', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/roles', body: SAMPLE },
      { method: 'GET', url: '/v1/operators', body: OPERATORS_SAMPLE },
    ]);
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();

    // Switch to the Archon assignments tab.
    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /Archon assignments/i }));

    // Wait for archons to appear.
    await waitFor(() => expect(screen.getByText('archon-alice')).toBeInTheDocument());

    // Each AID is a link with the correct href.
    const linkAlice = screen.getByRole('link', { name: 'archon-alice' });
    expect(linkAlice).toHaveAttribute('href', '/archons/archon-alice');

    const linkBootstrap = screen.getByRole('link', { name: 'archon-bootstrap' });
    expect(linkBootstrap).toHaveAttribute('href', '/archons/archon-bootstrap');

    const linkBob = screen.getByRole('link', { name: 'archon-bob' });
    expect(linkBob).toHaveAttribute('href', '/archons/archon-bob');
  });

  it('[LINKS] AID with special characters is correctly URL-encoded', async () => {
    // AID with "+" or a space -- encodeURIComponent prevents a broken href.
    const specialSample = {
      items: [
        {
          name: 'cluster-admin',
          description: '',
          builtin: true,
          permissions: ['*'],
          operators: ['archon-special+one'],
        },
      ],
    };
    const specialOperators = {
      items: [
        { aid: 'archon-special+one', display_name: 'Special', auth_method: 'jwt', created_at: '2026-05-01', created_by_aid: null, revoked_at: null, bootstrap_initial: false },
      ],
      offset: 0, limit: 200, total: 1,
    };
    installFetchMock([
      { method: 'GET', url: '/v1/roles', body: specialSample },
      { method: 'GET', url: '/v1/operators', body: specialOperators },
    ]);
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /Archon assignments/i }));

    await waitFor(() => expect(screen.getByText('archon-special+one')).toBeInTheDocument());

    const link = screen.getByRole('link', { name: 'archon-special+one' });
    expect(link).toHaveAttribute('href', `/archons/${encodeURIComponent('archon-special+one')}`);
  });
});
