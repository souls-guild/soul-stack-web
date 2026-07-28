import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { CreateRolePage } from '../pages/rbac/CreateRolePage';
import { tokenStore } from '../api/tokenStore';

// NIM-182 / ADR-078 — creating a DERIVED role in the UI: pick a parent, see the ceiling
// it hands down, pick a subset of its permissions and add only a narrowing delta.
//
// The invariants guarded here are the ones a wrong UI would break silently: emitting the
// parent's own scope as the child's delta (a no-op that reads as narrowing, and a
// widening the moment the parent is re-scoped), offering a permission outside the parent
// (403 on submit at best), or carrying a selection across a re-root.

const PERMISSIONS_SAMPLE = {
  items: [
    {
      resource: 'incarnation',
      actions: [
        { action: 'read', selector_keys: ['service'] },
        { action: 'run', selector_keys: ['service'] },
        { action: 'destroy', selector_keys: ['service'] },
      ],
    },
    { resource: 'soul', actions: [{ action: 'list', selector_keys: ['coven', 'sid'] }] },
    { resource: 'audit', actions: [{ action: 'read', selector_keys: [] }] },
  ],
};

// dba — the parent: read+run on incarnation, scoped to coven=dba. NOT incarnation.destroy,
// NOT soul.list, NOT `*`.
const ROLES_SAMPLE = {
  items: [
    {
      name: 'dba',
      builtin: false,
      description: 'database operators',
      permissions: ['incarnation.read', 'incarnation.run'],
      operators: ['AID-ME'],
      default_scope: 'coven=dba',
      effective_permissions: ['incarnation.read', 'incarnation.run'],
      effective_scope: 'coven=dba',
    },
    {
      name: 'cluster-admin',
      builtin: true,
      permissions: ['*'],
      operators: [],
      effective_permissions: ['*'],
    },
  ],
};

// The caller is cluster-admin unless a test overrides it: a bare unrestricted `*` means
// no caller-side gate, so the parent is the only bound under test.
const MY_PERMISSIONS = { permissions: [{ wildcard: true, scope: { unrestricted: true, exprs: [] } }] };

// A scope-restricted delegator: holds incarnation.* on coven=dba and role.create.
const MY_PERMISSIONS_SCOPED = {
  permissions: [
    { resource: 'incarnation', action: '*', wildcard: false, scope: { unrestricted: false, exprs: ['coven=dba'] } },
    { resource: 'role', action: 'create', wildcard: false, scope: { unrestricted: true, exprs: [] } },
  ],
};

const SYNODS_SAMPLE = { items: [] as unknown[] };

interface Call {
  url: string;
  method: string;
  body: string | null;
}

function recordingFetch(opts?: {
  rolesStatus?: number;
  createStatus?: number;
  createDetail?: string;
  myPermissions?: unknown;
  synods?: unknown;
}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : null;
    calls.push({ url, method, body });
    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });

    if (url === '/v1/roles' && method === 'POST') {
      if (opts?.createStatus) {
        return new Response(
          JSON.stringify({
            type: 'about:blank',
            title: 'Forbidden',
            status: opts.createStatus,
            detail: opts.createDetail ?? '',
          }),
          { status: opts.createStatus, headers: { 'Content-Type': 'application/problem+json' } },
        );
      }
      return new Response('', { status: 201 });
    }
    if (url === '/v1/roles' && method === 'GET') {
      if (opts?.rolesStatus) return new Response('{}', { status: opts.rolesStatus });
      return json(ROLES_SAMPLE);
    }
    if (url.startsWith('/v1/me/permissions')) return json(opts?.myPermissions ?? MY_PERMISSIONS);
    if (url.startsWith('/v1/permissions')) return json(PERMISSIONS_SAMPLE);
    if (url.startsWith('/v1/synods')) return json(opts?.synods ?? SYNODS_SAMPLE);
    if (url.startsWith('/v1/incarnations')) return json({ items: [], offset: 0, limit: 200, total: 0 });
    if (url.startsWith('/v1/services')) return json({ items: [] });
    if (url.startsWith('/v1/souls')) return json({ items: [], offset: 0, limit: 500, total: 0 });
    return new Response('{}', { status: 599 });
  });
  return calls;
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/rbac" element={<div>RBAC-LANDING</div>} />
      <Route path="/rbac/roles/new" element={<CreateRolePage />} />
    </Routes>,
    '/rbac/roles/new',
  );
}

async function pickParent(user: ReturnType<typeof userEvent.setup>, name: string) {
  const picker = await parentSelect();
  await user.click(await screen.findByTestId(`parent-role-option-${name}`));
  return picker;
}

// The catalog arrives async — wait for it before touching the rows.
async function parentSelect() {
  const picker = await screen.findByTestId('parent-role-select');
  await screen.findByTestId('parent-role-option-dba');
  return picker;
}

function postBody(calls: Call[]): Record<string, unknown> {
  const post = calls.find((c) => c.url === '/v1/roles' && c.method === 'POST');
  expect(post).toBeDefined();
  return JSON.parse(post!.body ?? '{}');
}

describe('CreateRolePage — derived roles (NIM-182)', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('★ a parent is REQUIRED — there is no way to build a role out of nothing', async () => {
    const calls = recordingFetch();
    renderPage();
    const user = userEvent.setup();
    await parentSelect();

    // No "plain role" escape hatch in the picker at all.
    expect(screen.queryByTestId('parent-role-option-none')).not.toBeInTheDocument();
    expect(screen.getByTestId('parent-role-option-dba')).toHaveAttribute('aria-checked', 'false');
    // Nothing picked yet → no ceiling to show.
    expect(screen.queryByTestId('inherited-ceiling-panel')).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('soul-operator'), 'orphan-role');
    await user.click(screen.getByRole('button', { name: /^Create$/ }));

    expect(await screen.findByTestId('parent-role-error')).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/v1/roles' && c.method === 'POST')).toBeUndefined();
  });

  it('the picker filters by name — a catalog of roles outgrows one screen', async () => {
    recordingFetch();
    renderPage();
    const user = userEvent.setup();
    await parentSelect();
    await user.type(screen.getByTestId('parent-role-search'), 'cluster');
    expect(screen.getByTestId('parent-role-option-cluster-admin')).toBeInTheDocument();
    expect(screen.queryByTestId('parent-role-option-dba')).not.toBeInTheDocument();
  });

  it('picking a parent shows its inherited scope and the set to pick from', async () => {
    recordingFetch();
    renderPage();
    const user = userEvent.setup();
    await pickParent(user, 'dba');

    const panel = await screen.findByTestId('inherited-ceiling-panel');
    expect(within(panel).getByTestId('inherited-scope')).toHaveTextContent('coven=dba');
    expect(panel).toHaveTextContent('incarnation.read');
    expect(panel).toHaveTextContent('incarnation.run');
    // What the parent does NOT grant is absent from the allowed set.
    expect(panel).not.toHaveTextContent('incarnation.destroy');
    expect(await screen.findByTestId('perm-parent-subset-note')).toBeInTheDocument();
  });

  it('a permission outside the parent is disabled, and full access is off-limits', async () => {
    recordingFetch();
    renderPage();
    const user = userEvent.setup();
    await pickParent(user, 'dba');

    await user.click(await screen.findByRole('button', { name: 'resource incarnation' }));
    expect(screen.getByRole('checkbox', { name: 'incarnation.read' })).toBeEnabled();
    // Outside the parent → disabled, and clicking it changes nothing.
    const destroy = screen.getByRole('checkbox', { name: 'incarnation.destroy' });
    expect(destroy).toBeDisabled();
    await user.click(destroy);
    expect(destroy).not.toBeChecked();
    // `incarnation.*` is WIDER than read+run — the parent doesn't cover it.
    expect(screen.getByRole('checkbox', { name: /incarnation\.\*/ })).toBeDisabled();
    // Cluster-admin `*` under a non-admin parent is impossible.
    expect(screen.getByTestId('perm-full-access-toggle')).toBeDisabled();
    // A resource the parent grants nothing on is marked as such in the rail.
    expect(screen.getByTestId('perm-resource-blocked-soul')).toBeInTheDocument();
  });

  it('★ the emitted default_scope is ONLY the delta — never the parent scope restated', async () => {
    const calls = recordingFetch();
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('soul-operator'), 'dba-aboba');
    await pickParent(user, 'dba');

    // The role-level scope field is the delta on a derived role.
    const delta = await screen.findByRole('group', { name: /narrowing delta on top of dba/i });
    await user.click(within(delta).getByTestId('scope-mode-on'));
    await user.selectOptions(within(delta).getByTestId('scope-dim'), 'trait');
    await user.type(within(delta).getByTestId('scope-trait-key'), 'project');
    await user.type(within(delta).getByTestId('scope-trait-value'), 'aboba');

    await user.click(await screen.findByRole('button', { name: 'resource incarnation' }));
    await user.click(screen.getByRole('checkbox', { name: 'incarnation.read' }));
    await user.click(screen.getByRole('button', { name: /^Create$/ }));

    await waitFor(() => {
      const body = postBody(calls);
      expect(body.parent_role).toBe('dba');
      expect(body.permissions).toEqual(['incarnation.read']);
      // The delta and nothing else: the server conjoins the parent's coven=dba itself.
      expect(body.default_scope).toBe('trait.project=aboba');
      expect(String(body.default_scope)).not.toContain('coven=dba');
    });
  });

  it('the delta builder shows the inherited term read-only next to the operator’s own', async () => {
    recordingFetch();
    renderPage();
    const user = userEvent.setup();
    await pickParent(user, 'dba');

    const delta = await screen.findByRole('group', { name: /narrowing delta on top of dba/i });
    await user.click(within(delta).getByTestId('scope-mode-on'));
    await user.type(within(delta).getByTestId('scope-add-value'), 'payments{Enter}');

    const preview = within(delta).getByTestId('scope-preview-code');
    // Inherited part is rendered as its own (read-only) term, AND-ed with the delta.
    expect(within(preview).getByTestId('scope-preview-inherited')).toHaveTextContent('coven=dba');
    expect(preview).toHaveTextContent(/coven\s*=\s*payments/);
    expect(within(delta).getByTestId('scope-preview-legend')).toBeInTheDocument();
  });

  it('per-permission scope builders show the parent ceiling, not the caller’s own rights', async () => {
    recordingFetch();
    renderPage();
    const user = userEvent.setup();
    await pickParent(user, 'dba');

    await user.click(await screen.findByRole('button', { name: 'resource incarnation' }));
    await user.click(screen.getByRole('checkbox', { name: 'incarnation.read' }));
    const builder = screen.getByRole('group', { name: 'scope for incarnation.read' });
    const ceiling = within(builder).getByTestId('scope-inherited-ceiling');
    expect(ceiling).toHaveTextContent(/Inherited from dba/i);
    expect(ceiling).toHaveTextContent('coven=dba');
  });

  it('re-rooting clears the picked set — rights are re-reviewed under the new parent', async () => {
    const calls = recordingFetch();
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('soul-operator'), 'switcher');
    await pickParent(user, 'cluster-admin');
    await user.click(await screen.findByRole('button', { name: 'resource soul' }));
    await user.click(screen.getByRole('checkbox', { name: 'soul.list' }));

    // soul.list is inside cluster-admin's `*` but outside dba — it must not survive.
    await pickParent(user, 'dba');
    await user.click(screen.getByRole('button', { name: /^Create$/ }));

    await waitFor(() => {
      const body = postBody(calls);
      expect(body.parent_role).toBe('dba');
      expect(body.permissions).toBeUndefined();
    });
  });

  it('403 beyond-the-parent is reported in plain words', async () => {
    recordingFetch({
      createStatus: 403,
      createDetail: 'a derived role may not exceed its parent role',
    });
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('soul-operator'), 'too-wide');
    await pickParent(user, 'dba');
    await user.click(screen.getByRole('button', { name: /^Create$/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/may not exceed its parent/i);
    expect(screen.queryByText('RBAC-LANDING')).not.toBeInTheDocument();
  });

  it('★ an unreadable role catalog blocks creation — there is nothing to derive from', async () => {
    const calls = recordingFetch({ rolesStatus: 403 });
    renderPage();
    const user = userEvent.setup();

    expect(await screen.findByTestId('parent-role-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('parent-role-select')).not.toBeInTheDocument();

    // Degrading to an unbounded plain role would be exactly the thing derivation exists
    // to prevent, so the form refuses instead of quietly widening.
    await user.type(screen.getByPlaceholderText('soul-operator'), 'plain-role');
    await user.click(screen.getByRole('button', { name: /^Create$/ }));
    expect(await screen.findByTestId('parent-role-error')).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/v1/roles' && c.method === 'POST')).toBeUndefined();
  });

  it('★ offers ONLY the roles the caller holds — the rest are not on the page at all', async () => {
    // AID-ME is in dba's operators, not in cluster-admin's; the caller holds no bare `*`.
    tokenStore.set(`h.${btoa(JSON.stringify({ sub: 'AID-ME' }))}.s`);
    recordingFetch({ myPermissions: MY_PERMISSIONS_SCOPED });
    renderPage();

    await parentSelect();
    expect(screen.getByTestId('parent-role-option-dba')).toBeInTheDocument();
    // Not held → not shown, and no opt-in to reveal it: the server would refuse it as a
    // parent, so offering it could only ever end in a 403.
    expect(screen.queryByTestId('parent-role-option-cluster-admin')).not.toBeInTheDocument();
    expect(screen.queryByTestId('parent-role-show-all')).not.toBeInTheDocument();
  });

  it('a role held through a Synod counts as held', async () => {
    tokenStore.set(`h.${btoa(JSON.stringify({ sub: 'AID-SYNOD' }))}.s`);
    recordingFetch({
      myPermissions: MY_PERMISSIONS_SCOPED,
      synods: { items: [{ name: 'dbas', builtin: false, operators: ['AID-SYNOD'], roles: ['cluster-admin'] }] },
    });
    renderPage();

    // Direct membership has nothing for this AID; the Synod grants cluster-admin.
    expect(await screen.findByTestId('parent-role-option-cluster-admin')).toBeInTheDocument();
    expect(screen.queryByTestId('parent-role-option-dba')).not.toBeInTheDocument();
  });

  it('★ the caller’s own rights still bound the form when the PARENT is wider than them', async () => {
    // The Synod hands this caller cluster-admin (so `*` is offerable as a parent), but
    // their own permissions are only incarnation.* on coven=dba. The parent bound alone
    // would open the whole catalog; the caller bound is what must still hold.
    tokenStore.set(`h.${btoa(JSON.stringify({ sub: 'AID-SYNOD' }))}.s`);
    recordingFetch({
      myPermissions: MY_PERMISSIONS_SCOPED,
      synods: { items: [{ name: 'dbas', builtin: false, operators: ['AID-SYNOD'], roles: ['cluster-admin'] }] },
    });
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('parent-role-option-cluster-admin'));

    expect(await screen.findByTestId('perm-caller-subset-note')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'resource incarnation' }));
    // Held by the caller and granted by the parent → grantable.
    expect(screen.getByRole('checkbox', { name: 'incarnation.destroy' })).toBeEnabled();
    // Granted by the parent (`*`) but NOT held by the caller → still blocked.
    expect(screen.getByTestId('perm-resource-blocked-soul')).toBeInTheDocument();
    expect(screen.getByTestId('perm-full-access-toggle')).toBeDisabled();
  });

  it('★ pin mode stores the parent scope with the delta; track stores the delta alone', async () => {
    const calls = recordingFetch();
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('soul-operator'), 'dba-pinned');
    await pickParent(user, 'dba');

    const delta = await screen.findByRole('group', { name: /narrowing delta on top of dba/i });
    await user.click(within(delta).getByTestId('scope-mode-on'));
    await user.selectOptions(within(delta).getByTestId('scope-dim'), 'trait');
    await user.type(within(delta).getByTestId('scope-trait-key'), 'project');
    await user.type(within(delta).getByTestId('scope-trait-value'), 'aboba');

    // Pin: the parent's scope as it is now travels into the child's own row, so a later
    // widening of the parent cannot reach it (the conjunction keeps coven=dba).
    await user.click(screen.getByTestId('role-scope-mode-pin'));
    expect(screen.getByTestId('role-scope-stored')).toHaveTextContent('coven=dba AND trait.project=aboba');
    await user.click(screen.getByRole('button', { name: /^Create$/ }));

    await waitFor(() => {
      expect(postBody(calls).default_scope).toBe('coven=dba AND trait.project=aboba');
    });
  });

  it('★ a scope-restricted caller gets pin by DEFAULT — track would let the parent widen this role', async () => {
    const calls = recordingFetch({ myPermissions: MY_PERMISSIONS_SCOPED });
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('soul-operator'), 'dba-delegated');
    await pickParent(user, 'dba');

    // Nothing clicked on the mode toggle: the default alone must already store the
    // parent's current scope, or a later widening of dba silently reaches this role.
    expect(await screen.findByTestId('role-scope-mode-pin')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('role-scope-stored')).toHaveTextContent('coven=dba');

    await user.click(screen.getByRole('button', { name: /^Create$/ }));
    await waitFor(() => {
      expect(postBody(calls).default_scope).toBe('coven=dba');
    });
  });

  it('an unrestricted caller keeps track as the default — they own the parent too', async () => {
    recordingFetch();
    renderPage();
    const user = userEvent.setup();

    await pickParent(user, 'dba');
    expect(await screen.findByTestId('role-scope-mode-track')).toHaveAttribute('aria-pressed', 'true');
  });

});
