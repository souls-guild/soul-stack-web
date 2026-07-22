import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { SynodDetail } from '../pages/synods/SynodDetail';
import { tokenStore } from '../api/tokenStore';

// Test data.
const SYNODS_SAMPLE = {
  items: [
    {
      name: 'ops-team',
      description: 'Operations team',
      builtin: false,
      roles: ['cluster-admin', 'viewer'],
      operators: ['archon-alice', 'archon-bob'],
    },
    {
      name: 'empty-group',
      description: '',
      builtin: false,
      roles: [],
      operators: [],
    },
  ],
};

const ROLES_SAMPLE = {
  items: [
    { name: 'cluster-admin', description: 'Full access', builtin: true, permissions: ['*'], operators: [] },
    { name: 'viewer', description: '', builtin: false, permissions: ['soul.list'], operators: [] },
    { name: 'soul-operator', description: '', builtin: false, permissions: ['soul.list'], operators: [] },
  ],
};

// All cluster archons for AddOperatorModal (server-side typeahead).
const OPERATORS_SAMPLE = {
  items: [
    { aid: 'archon-alice', display_name: 'Alice', auth_method: 'jwt', revoked_at: null },
    { aid: 'archon-bob', display_name: 'Bob', auth_method: 'jwt', revoked_at: null },
    { aid: 'archon-charlie', display_name: 'Charlie', auth_method: 'jwt', revoked_at: null },
    { aid: 'archon-dave', display_name: 'Dave', auth_method: 'jwt', revoked_at: null },
  ],
};

const MY_PERMS_WILDCARD = { permissions: [{ wildcard: true }] };
const MY_PERMS_READONLY = {
  permissions: [{ wildcard: false, resource: 'soul', action: 'list' }],
};
const MY_PERMS_NO_UPDATE = {
  permissions: [
    { wildcard: false, resource: 'soul', action: 'list' },
    { wildcard: false, resource: 'synod', action: 'add-operator' },
    { wildcard: false, resource: 'synod', action: 'remove-operator' },
    { wildcard: false, resource: 'synod', action: 'grant-role' },
    { wildcard: false, resource: 'synod', action: 'revoke-role' },
  ],
};

interface Call {
  url: string;
  method: string;
  body: string | null;
}

function recordingFetch(opts: {
  synods?: typeof SYNODS_SAMPLE | { items: [] };
  myPerms?: typeof MY_PERMS_WILDCARD;
  roles?: typeof ROLES_SAMPLE;
  operators?: typeof OPERATORS_SAMPLE;
  synodsStatus?: number;
  conflict?: { path: RegExp; method: string; status: number; type?: string; detail?: string };
}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
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
        {
          status: opts.conflict.status,
          headers: { 'Content-Type': 'application/problem+json' },
        },
      );
    }

    if (url.startsWith('/v1/me/permissions') && method === 'GET') {
      return new Response(JSON.stringify(opts.myPerms ?? MY_PERMS_WILDCARD), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('/v1/synods') && method === 'GET') {
      const status = opts.synodsStatus ?? 200;
      if (status !== 200) {
        return new Response(
          JSON.stringify({ type: 'about:blank', title: 'Error', status, detail: 'server error' }),
          { status, headers: { 'Content-Type': 'application/problem+json' } },
        );
      }
      return new Response(JSON.stringify(opts.synods ?? SYNODS_SAMPLE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('/v1/roles') && method === 'GET') {
      return new Response(JSON.stringify(opts.roles ?? ROLES_SAMPLE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('/v1/operators') && method === 'GET') {
      return new Response(JSON.stringify(opts.operators ?? OPERATORS_SAMPLE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (/^\/v1\/synods\/[^/]+$/.test(url) && method === 'PATCH') {
      return new Response(null, { status: 204 });
    }
    if (/^\/v1\/synods\/[^/]+\/operators$/.test(url) && method === 'POST') {
      return new Response('', { status: 201 });
    }
    if (/^\/v1\/synods\/[^/]+\/operators\/[^/]+$/.test(url) && method === 'DELETE') {
      return new Response('', { status: 204 });
    }
    if (/^\/v1\/synods\/[^/]+\/roles$/.test(url) && method === 'POST') {
      return new Response('', { status: 201 });
    }
    if (/^\/v1\/synods\/[^/]+\/roles\/[^/]+$/.test(url) && method === 'DELETE') {
      return new Response('', { status: 204 });
    }

    return new Response('{}', { status: 599 });
  });
  return calls;
}

function withRoute() {
  return (
    <Routes>
      <Route path="/synods/:name" element={<SynodDetail />} />
    </Routes>
  );
}

describe('SynodDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  it('renders Members section: list of archons from ops-team', async () => {
    recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ops-team');
    await waitFor(() => {
      expect(screen.getByText('archon-alice')).toBeInTheDocument();
      expect(screen.getByText('archon-bob')).toBeInTheDocument();
    });
    // Members section is present.
    expect(screen.getByRole('region', { name: /members/i })).toBeInTheDocument();
  });

  it('renders Roles section: roles bound to ops-team', async () => {
    recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ops-team');
    await waitFor(() => {
      expect(screen.getByText('cluster-admin')).toBeInTheDocument();
      expect(screen.getByText('viewer')).toBeInTheDocument();
    });
    expect(screen.getByRole('region', { name: /group-roles/i })).toBeInTheDocument();
  });

  it('filters by :name — navigating to /synods/empty-group', async () => {
    recordingFetch({});
    renderWithProviders(withRoute(), '/synods/empty-group');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'empty-group' })).toBeInTheDocument();
    });
    // archon-alice from ops-team must not be visible.
    expect(screen.queryByText('archon-alice')).not.toBeInTheDocument();
  });

  it('empty-state members: noMembers when operators is empty', async () => {
    recordingFetch({});
    renderWithProviders(withRoute(), '/synods/empty-group');
    await waitFor(() => {
      expect(screen.getByText(/No members/i)).toBeInTheDocument();
    });
  });

  it('empty-state roles: noRoles when roles is empty', async () => {
    recordingFetch({});
    renderWithProviders(withRoute(), '/synods/empty-group');
    await waitFor(() => {
      expect(screen.getByText(/No roles in this group/i)).toBeInTheDocument();
    });
  });

  it('isLoading: shows loading indicator while data loads', async () => {
    // Fetch never resolves — checking the loading state.
    let resolve: ((v: Response) => void) | undefined;
    vi.stubGlobal('fetch', () =>
      new Promise<Response>((r) => {
        resolve = r;
      }));

    renderWithProviders(withRoute(), '/synods/ops-team');
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();

    // Resolve the promise so it doesn't leak.
    resolve!(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });

  it('error: shows errorBox on GET /v1/synods failure', async () => {
    recordingFetch({ synodsStatus: 500 });
    renderWithProviders(withRoute(), '/synods/ops-team');
    await waitFor(() => {
      // errorBox contains the error status.
      expect(screen.getByText(/500/)).toBeInTheDocument();
    });
  });

  it('synod-not-found: shows errors:synodNotFound when name is not in items', async () => {
    recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ghost-group');
    await waitFor(() => {
      expect(screen.getByText(/Synod not found/i)).toBeInTheDocument();
    });
  });

  it('Remove-operator: DELETE /v1/synods/{name}/operators/{aid} via × button', async () => {
    const calls = recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ops-team');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('archon-alice')).toBeInTheDocument());
    const removeBtn = screen.getByRole('button', { name: /remove archon-alice from group/i });
    await user.click(removeBtn);

    await waitFor(() => {
      const del = calls.find(
        (c) =>
          c.url === '/v1/synods/ops-team/operators/archon-alice' && c.method === 'DELETE',
      );
      expect(del).toBeDefined();
    });
  });

  it('Revoke-role: DELETE /v1/synods/{name}/roles/{role} via × button', async () => {
    const calls = recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ops-team');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());
    const revokeBtn = screen.getByRole('button', { name: /unbind role cluster-admin from group/i });
    await user.click(revokeBtn);

    await waitFor(() => {
      const del = calls.find(
        (c) =>
          c.url === '/v1/synods/ops-team/roles/cluster-admin' && c.method === 'DELETE',
      );
      expect(del).toBeDefined();
    });
  });

  it('Remove-operator error 409: inline memberError shown in members section', async () => {
    recordingFetch({
      conflict: {
        path: /^\/v1\/synods\/ops-team\/operators\/archon-alice$/,
        method: 'DELETE',
        status: 409,
        type: 'https://soul-stack.io/errors/would-lock-out-cluster',
        detail: 'last cluster-admin',
      },
    });
    renderWithProviders(withRoute(), '/synods/ops-team');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('archon-alice')).toBeInTheDocument());
    const removeBtn = screen.getByRole('button', { name: /remove archon-alice from group/i });
    await user.click(removeBtn);

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/lock-?out|admin/i);
    });
  });

  it('Revoke-role error 403: inline roleError shown in roles section', async () => {
    recordingFetch({
      conflict: {
        path: /^\/v1\/synods\/ops-team\/roles\/cluster-admin$/,
        method: 'DELETE',
        status: 403,
        type: 'https://soul-stack.io/errors/subset-denied',
        detail: 'subset',
      },
    });
    renderWithProviders(withRoute(), '/synods/ops-team');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());
    const revokeBtn = screen.getByRole('button', { name: /unbind role cluster-admin from group/i });
    await user.click(revokeBtn);

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/subset|escalation|permission/i);
    });
  });

  it('[RBAC] without synod.add-operator the "Add archon" button is not rendered', async () => {
    recordingFetch({ myPerms: MY_PERMS_READONLY });
    renderWithProviders(withRoute(), '/synods/ops-team');
    await waitFor(() => expect(screen.getByText('archon-alice')).toBeInTheDocument());
    expect(screen.queryByTestId('add-operator-btn')).not.toBeInTheDocument();
  });

  it('[RBAC] without synod.grant-role the "Bind role" button is not rendered', async () => {
    recordingFetch({ myPerms: MY_PERMS_READONLY });
    renderWithProviders(withRoute(), '/synods/ops-team');
    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());
    expect(screen.queryByTestId('grant-role-btn')).not.toBeInTheDocument();
  });

  // --- Edit guard tests ---

  it('[EDIT] edit-synod-btn opens EditSynodModal with name and description', async () => {
    const { within: w } = await import('@testing-library/react');
    recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ops-team');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ops-team' })).toBeInTheDocument());
    await user.click(screen.getByTestId('edit-synod-btn'));

    const dialog = await screen.findByRole('dialog', { name: /Edit Synod: ops-team/i });
    expect(w(dialog).getByTestId('edit-synod-name-readonly')).toHaveValue('ops-team');
    expect(w(dialog).getByTestId('edit-synod-description-input')).toHaveValue('Operations team');
  });

  it('[EDIT] PATCH /v1/synods/{name} sends { description }', async () => {
    const { within: w } = await import('@testing-library/react');
    const calls = recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ops-team');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ops-team' })).toBeInTheDocument());
    await user.click(screen.getByTestId('edit-synod-btn'));

    const dialog = await screen.findByRole('dialog', { name: /Edit Synod: ops-team/i });
    const textarea = w(dialog).getByTestId('edit-synod-description-input');
    await user.clear(textarea);
    await user.type(textarea, 'New description');
    await user.click(w(dialog).getByRole('button', { name: /^Save$/ }));

    await waitFor(() => {
      const patch = calls.find((c) => c.url === '/v1/synods/ops-team' && c.method === 'PATCH');
      expect(patch).toBeDefined();
      const parsed = JSON.parse(patch!.body ?? '{}');
      expect(parsed).toMatchObject({ description: 'New description' });
    });
  });

  it('[EDIT][RBAC] without synod.update edit-synod-btn is disabled', async () => {
    recordingFetch({ myPerms: MY_PERMS_NO_UPDATE });
    renderWithProviders(withRoute(), '/synods/ops-team');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ops-team' })).toBeInTheDocument());
    const btn = screen.getByTestId('edit-synod-btn');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', expect.stringMatching(/synod\.update/i));
  });

  it('[EDIT] 422 from PATCH is shown in the modal', async () => {
    const { within: w } = await import('@testing-library/react');
    recordingFetch({
      conflict: {
        path: /^\/v1\/synods\/ops-team$/,
        method: 'PATCH',
        status: 422,
        detail: 'description too long',
      },
    });
    renderWithProviders(withRoute(), '/synods/ops-team');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ops-team' })).toBeInTheDocument());
    await user.click(screen.getByTestId('edit-synod-btn'));

    const dialog = await screen.findByRole('dialog', { name: /Edit Synod: ops-team/i });
    await user.click(w(dialog).getByRole('button', { name: /^Save$/ }));

    const alert = await w(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(/description too long|valid/i);
    expect(screen.getByRole('dialog', { name: /Edit Synod/i })).toBeInTheDocument();
  });

  // -- Guard tests: clickable links --------------------------------------------------

  it('[LINKS] member archons render as links to /archons/:aid', async () => {
    recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ops-team');

    await waitFor(() => expect(screen.getByText('archon-alice')).toBeInTheDocument());

    const linkAlice = screen.getByRole('link', { name: 'archon-alice' });
    expect(linkAlice).toHaveAttribute('href', '/archons/archon-alice');

    const linkBob = screen.getByRole('link', { name: 'archon-bob' });
    expect(linkBob).toHaveAttribute('href', '/archons/archon-bob');
  });

  it('[LINKS] group roles render as links to /rbac', async () => {
    recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ops-team');

    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());

    const linkAdmin = screen.getByRole('link', { name: 'cluster-admin' });
    expect(linkAdmin).toHaveAttribute('href', '/rbac');

    const linkViewer = screen.getByRole('link', { name: 'viewer' });
    expect(linkViewer).toHaveAttribute('href', '/rbac');
  });

  it('[LINKS] no links when sections are empty (empty-group)', async () => {
    recordingFetch({});
    renderWithProviders(withRoute(), '/synods/empty-group');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'empty-group' })).toBeInTheDocument());

    // No links to archons and roles in an empty group.
    expect(screen.queryByRole('link', { name: /archon-/i })).not.toBeInTheDocument();
  });

  // -- Picker tests (typeahead multi-select) -------------------------------------------

  it('[ADD] AddOperatorModal: typeahead select → POST /v1/synods/{name}/operators', async () => {
    const { within: w } = await import('@testing-library/react');
    const calls = recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ops-team');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ops-team' })).toBeInTheDocument());
    await user.click(screen.getByTestId('add-operator-btn'));

    const dialog = await screen.findByRole('dialog', { name: /Add archon to ops-team/i });
    await user.click(w(dialog).getByTestId('add-operator-search'));
    // archon-dave is not a member of ops-team -> available in options.
    await user.click(await w(dialog).findByTestId('add-operator-option-archon-dave'));
    await user.click(w(dialog).getByTestId('add-operator-submit'));

    await waitFor(() => {
      const post = calls.find(
        (c) => c.url === '/v1/synods/ops-team/operators' && c.method === 'POST',
      );
      expect(post).toBeDefined();
      expect(post!.body).toContain('archon-dave');
    });
  });

  // Guard NIM-70: headline contract — archon search is SERVER-SIDE (GET /v1/operators?q=...),
  // not "fetch all + .filter on the client". A regression to client-side filtering would pass
  // all other picker tests (they don't type into the search), but would break with 50+ archons.
  it('[SERVER-Q] AddOperatorModal: search input goes out as ?q= in GET /v1/operators', async () => {
    const { within: w } = await import('@testing-library/react');
    const calls = recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ops-team');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ops-team' })).toBeInTheDocument());
    await user.click(screen.getByTestId('add-operator-btn'));

    const dialog = await screen.findByRole('dialog', { name: /Add archon to ops-team/i });
    // Type a substring — the picker must forward it to the server (debounce inside SearchMultiSelect).
    await user.type(w(dialog).getByTestId('add-operator-search'), 'dave');

    await waitFor(
      () => {
        const served = calls.find((c) => {
          if (c.method !== 'GET' || !c.url.startsWith('/v1/operators')) return false;
          const qs = new URLSearchParams(c.url.split('?')[1] ?? '');
          return qs.get('q') === 'dave';
        });
        expect(
          served,
          'picker must send ?q= to the server (server-side search), not filter client-side',
        ).toBeDefined();
      },
      { timeout: 2000 },
    );
  });

  it('[GRANT] GrantRoleModal: typeahead select → POST /v1/synods/{name}/roles', async () => {
    const { within: w } = await import('@testing-library/react');
    const calls = recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ops-team');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ops-team' })).toBeInTheDocument());
    await user.click(screen.getByTestId('grant-role-btn'));

    const dialog = await screen.findByRole('dialog', { name: /Bind role to ops-team/i });
    await user.click(w(dialog).getByTestId('grant-role-search'));
    // soul-operator is not tied to ops-team -> available in options.
    await user.click(await w(dialog).findByTestId('grant-role-option-soul-operator'));
    await user.click(w(dialog).getByTestId('grant-role-submit'));

    await waitFor(() => {
      const post = calls.find(
        (c) => c.url === '/v1/synods/ops-team/roles' && c.method === 'POST',
      );
      expect(post).toBeDefined();
      expect(post!.body).toContain('soul-operator');
    });
  });
});
