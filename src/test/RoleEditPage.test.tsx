import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { RoleEditPage } from '../pages/rbac/RoleEditPage';
import { tokenStore } from '../api/tokenStore';

// Role permission editing moved from a modal (EditPermissionsModal) to a dedicated
// full page /rbac/roles/:name/edit (NIM-128). These tests mirror the flows that used
// to live in RbacPage.test.tsx's "Edit permissions" cases.

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

interface Call {
  url: string;
  method: string;
  body: string | null;
}

function recordingFetch(opts: {
  rolesList: typeof SAMPLE;
  permissions?: typeof PERMISSIONS_SAMPLE;
  myPermissions?: unknown;
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

    if (url.startsWith('/v1/me/permissions') && method === 'GET') {
      if (!opts.myPermissions) return new Response('{}', { status: 599 });
      return new Response(JSON.stringify(opts.myPermissions), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('/v1/permissions') && method === 'GET') {
      return new Response(JSON.stringify(opts.permissions ?? PERMISSIONS_SAMPLE), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
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
    // 204 is a null-body status — a non-null body ('') makes the Response ctor throw.
    if (/^\/v1\/roles\/[^/]+\/permissions$/.test(url) && method === 'PATCH') return new Response(null, { status: 204 });

    return new Response('{}', { status: 599 });
  });
  return calls;
}

function renderEdit(name: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/rbac" element={<div>RBAC-LANDING</div>} />
      <Route path="/rbac/roles/:name/edit" element={<RoleEditPage />} />
    </Routes>,
    `/rbac/roles/${encodeURIComponent(name)}/edit`,
  );
}

describe('RoleEditPage (NIM-128)', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('PATCH /v1/roles/{name}/permissions with the new set → navigates to /rbac', async () => {
    const calls = recordingFetch({ rolesList: SAMPLE });
    renderEdit('soul-operator');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: /Permissions: soul-operator/i });

    // Master-detail: select soul, uncheck soul.exec; select incarnation, check incarnation.read.
    await user.click(await screen.findByRole('button', { name: 'resource soul' }));
    const soulExec = screen.getByRole('checkbox', { name: 'soul.exec' });
    expect(soulExec).toBeChecked();
    await user.click(soulExec);
    await user.click(screen.getByRole('button', { name: 'resource incarnation' }));
    await user.click(screen.getByRole('checkbox', { name: 'incarnation.read' }));
    await user.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/permissions'));
      expect(patch).toBeDefined();
      expect(patch!.url).toBe('/v1/roles/soul-operator/permissions');
      expect(patch!.body).toContain('incarnation.read');
      expect(patch!.body).not.toContain('soul.exec');
    });
    await waitFor(() => expect(screen.getByText('RBAC-LANDING')).toBeInTheDocument());
  });

  it('builtin role: Save disabled + editing-blocked warning', async () => {
    recordingFetch({ rolesList: SAMPLE });
    renderEdit('cluster-admin');

    await screen.findByRole('heading', { name: /Permissions: cluster-admin/i });
    expect(screen.getByRole('button', { name: /Save/i })).toBeDisabled();
    expect(screen.getByText(/Editing is disabled/i)).toBeInTheDocument();
  });

  it('catalog unavailable (empty) → graceful, existing permissions preserved on save', async () => {
    const calls = recordingFetch({ rolesList: SAMPLE, permissions: { items: [] } });
    renderEdit('soul-operator');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: /Permissions: soul-operator/i });
    expect(await screen.findByText(/Permission catalog is unavailable/i)).toBeInTheDocument();
    expect(screen.getByText('soul.exec')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Save/i }));
    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/permissions'));
      expect(patch).toBeDefined();
      expect(patch!.body).toContain('soul.exec');
    });
  });

  it('parses an existing scoped permission → checked checkbox', async () => {
    const sample = {
      items: [
        {
          name: 'scoped-role',
          description: '',
          builtin: false,
          permissions: ['soul.list on coven=ops', 'incarnation.run'],
          operators: [] as string[],
        },
      ],
    };
    recordingFetch({ rolesList: sample });
    renderEdit('scoped-role');
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: /Permissions: scoped-role/i });

    await user.click(await screen.findByRole('button', { name: 'resource incarnation' }));
    expect(screen.getByRole('checkbox', { name: 'incarnation.run' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'resource soul' }));
    expect(screen.getByRole('checkbox', { name: /soul\.list/ })).toBeChecked();
  });

  it('unknown role → graceful not-found with a link back', async () => {
    recordingFetch({ rolesList: SAMPLE });
    renderEdit('does-not-exist');

    expect(await screen.findByRole('heading', { name: /not found/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back/i })).toHaveAttribute('href', '/rbac');
  });

  // NIM-182 / ADR-078 — a derived role is edited under its parent's ceiling.
  describe('derived role', () => {
    const DERIVED = {
      items: [
        {
          name: 'soul-reader',
          description: 'parent',
          builtin: false,
          permissions: ['soul.list', 'soul.read'],
          operators: [] as string[],
          default_scope: 'coven=ops',
          effective_permissions: ['soul.list', 'soul.read'],
          effective_scope: 'coven=ops',
        },
        {
          name: 'soul-reader-web',
          description: 'child',
          builtin: false,
          permissions: ['soul.list'],
          operators: [] as string[],
          parent_role: 'soul-reader',
          default_scope: 'trait.tier=web',
          effective_permissions: ['soul.list on coven=ops AND trait.tier=web'],
          effective_scope: 'coven=ops AND trait.tier=web',
        },
      ],
    };

    it('shows the inherited ceiling and disables what the parent does not grant', async () => {
      recordingFetch({ rolesList: DERIVED });
      renderEdit('soul-reader-web');
      const user = userEvent.setup();

      await screen.findByRole('heading', { name: /Permissions: soul-reader-web/i });
      const panel = await screen.findByTestId('inherited-ceiling-panel');
      expect(panel).toHaveTextContent(/soul-reader/);
      expect(within(panel).getByTestId('inherited-scope')).toHaveTextContent('coven=ops');

      await user.click(await screen.findByRole('button', { name: 'resource soul' }));
      expect(screen.getByRole('checkbox', { name: 'soul.list' })).toBeChecked();
      // soul.exec is in the catalog but outside the parent.
      expect(screen.getByRole('checkbox', { name: 'soul.exec' })).toBeDisabled();
      // Another resource entirely — nothing there is grantable.
      expect(screen.getByTestId('perm-resource-blocked-incarnation')).toBeInTheDocument();
    });

    it('PATCH carries the delta as default_scope and leaves parent_role untouched', async () => {
      const calls = recordingFetch({ rolesList: DERIVED });
      renderEdit('soul-reader-web');
      const user = userEvent.setup();

      await screen.findByRole('heading', { name: /Permissions: soul-reader-web/i });
      // The stored delta seeds the builder — not the parent's scope.
      const delta = await screen.findByRole('group', { name: /narrowing delta on top of soul-reader/i });
      expect(within(delta).getByTestId('scope-trait-key')).toHaveValue('tier');

      await user.click(screen.getByRole('button', { name: /Save/i }));
      await waitFor(() => {
        const patch = calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/permissions'));
        expect(patch).toBeDefined();
        const body = JSON.parse(patch!.body ?? '{}');
        expect(body.default_scope).toBe('trait.tier=web');
        expect(String(body.default_scope)).not.toContain('coven=ops');
        // Omitted → the derivation is left as it is (PATCH presence semantics).
        expect('parent_role' in body).toBe(false);
      });
    });

    it('★ editing the PARENT lists the children a change would travel to', async () => {
      recordingFetch({ rolesList: DERIVED });
      renderEdit('soul-reader');

      await screen.findByRole('heading', { name: /Permissions: soul-reader/i });
      const panel = await screen.findByTestId('derived-children-panel');
      expect(panel).toHaveTextContent(/1 role\(s\) derive from this one/i);
      // Each child with its own narrowing and what it currently resolves to.
      const child = within(panel).getByTestId('derived-child-soul-reader-web');
      expect(child).toHaveTextContent('trait.tier=web');
      expect(child).toHaveTextContent('coven=ops AND trait.tier=web');
      // A leaf role has no such panel.
      expect(screen.queryByTestId('inherited-ceiling-panel')).not.toBeInTheDocument();
    });

    it('a parent outside the readable catalog degrades to a note, not a crash', async () => {
      recordingFetch({ rolesList: { items: [DERIVED.items[1]] } });
      renderEdit('soul-reader-web');

      await screen.findByRole('heading', { name: /Permissions: soul-reader-web/i });
      expect(await screen.findByTestId('parent-unresolved')).toBeInTheDocument();
      expect(screen.queryByTestId('inherited-ceiling-panel')).not.toBeInTheDocument();
    });
  });

  // New roles are always derived (NIM-182), but plain ones predate that rule and are
  // still editable — and there the caller's own scope is the only bound there is.
  describe('plain role edited by a scope-restricted caller', () => {
    const SCOPED_CALLER = {
      permissions: [
        { resource: 'soul', action: '*', wildcard: false, scope: { unrestricted: false, exprs: ['coven=dba'] } },
        { resource: 'role', action: 'update', wildcard: false, scope: { unrestricted: true, exprs: [] } },
      ],
    };

    it('★ warns that an unscoped plain role grants wider than the caller holds, and can adopt their scope', async () => {
      const calls = recordingFetch({ rolesList: SAMPLE, myPermissions: SCOPED_CALLER });
      renderEdit('soul-operator');
      const user = userEvent.setup();

      // soul-operator stores soul.list/read/exec with no scope; the caller holds soul.*
      // only on coven=dba, so saving it as is comes back 403.
      const warn = await screen.findByTestId('role-scope-caller-floor');
      expect(warn).toHaveTextContent(/coven\s*=\s*dba/);

      await user.click(screen.getByTestId('role-scope-apply-floor'));
      await waitFor(() => {
        expect(screen.queryByTestId('role-scope-caller-floor')).not.toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /^Save$/ }));
      await waitFor(() => {
        const patch = calls.find((c) => c.method === 'PATCH');
        expect(patch).toBeDefined();
        expect(JSON.parse(patch!.body ?? '{}').default_scope).toBe('coven=dba');
      });
    });

    it('stays quiet when the caller holds the rights unscoped', async () => {
      recordingFetch({
        rolesList: SAMPLE,
        myPermissions: {
          permissions: [
            { resource: 'soul', action: '*', wildcard: false, scope: { unrestricted: true, exprs: [] } },
            { resource: 'role', action: 'update', wildcard: false, scope: { unrestricted: true, exprs: [] } },
          ],
        },
      });
      renderEdit('soul-operator');

      await screen.findByRole('heading', { name: /Permissions: soul-operator/i });
      expect(screen.queryByTestId('role-scope-caller-floor')).not.toBeInTheDocument();
    });
  });
});
