import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
});
