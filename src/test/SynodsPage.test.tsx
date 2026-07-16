import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { SynodsList } from '../pages/synods/SynodsList';
import { tokenStore } from '../api/tokenStore';

// Sample data.
const SYNODS_SAMPLE = {
  items: [
    {
      name: 'ops-team',
      description: 'Operations team',
      builtin: false,
      roles: ['cluster-admin'],
      operators: ['archon-alice', 'archon-bob'],
    },
    {
      name: 'readonly',
      description: 'Read-only group',
      builtin: true,
      roles: ['viewer'],
      operators: ['archon-charlie'],
    },
  ],
};

const SYNODS_EMPTY = { items: [] };

const ROLES_SAMPLE = {
  items: [
    { name: 'cluster-admin', description: 'Full access', builtin: true, permissions: ['*'], operators: [] },
    { name: 'soul-operator', description: '', builtin: false, permissions: ['soul.list'], operators: [] },
    { name: 'viewer', description: '', builtin: false, permissions: ['soul.list'], operators: [] },
  ],
};

// All cluster archons for AddOperatorModal.
const OPERATORS_SAMPLE = {
  items: [
    { aid: 'archon-alice', display_name: 'Alice', auth_method: 'jwt', revoked_at: null },
    { aid: 'archon-bob', display_name: 'Bob', auth_method: 'jwt', revoked_at: null },
    { aid: 'archon-charlie', display_name: 'Charlie', auth_method: 'jwt', revoked_at: null },
    { aid: 'archon-dave', display_name: 'Dave', auth_method: 'jwt', revoked_at: null },
    // revoked -- must be filtered out
    { aid: 'archon-revoked', display_name: 'Revoked', auth_method: 'jwt', revoked_at: '2025-01-01T00:00:00Z' },
  ],
};

// Full permissions (wildcard) for tests where permissions are unrestricted.
const MY_PERMS_WILDCARD = { permissions: [{ wildcard: true }] };
// Permissions without synod.create.
const MY_PERMS_NO_CREATE = {
  permissions: [
    { wildcard: false, resource: 'soul', action: 'list' },
  ],
};
// Permissions without synod.update.
const MY_PERMS_NO_UPDATE = {
  permissions: [
    { wildcard: false, resource: 'soul', action: 'list' },
    { wildcard: false, resource: 'synod', action: 'create' },
    { wildcard: false, resource: 'synod', action: 'delete' },
    { wildcard: false, resource: 'synod', action: 'add-operator' },
    { wildcard: false, resource: 'synod', action: 'remove-operator' },
    { wildcard: false, resource: 'synod', action: 'grant-role' },
    { wildcard: false, resource: 'synod', action: 'revoke-role' },
  ],
};
// Permissions without synod.add-operator.
const MY_PERMS_NO_ADD_OP = {
  permissions: [
    { wildcard: false, resource: 'soul', action: 'list' },
    { wildcard: false, resource: 'synod', action: 'delete' },
    { wildcard: false, resource: 'synod', action: 'remove-operator' },
    { wildcard: false, resource: 'synod', action: 'grant-role' },
    { wildcard: false, resource: 'synod', action: 'revoke-role' },
  ],
};
// Permissions without synod.grant-role.
const MY_PERMS_NO_GRANT_ROLE = {
  permissions: [
    { wildcard: false, resource: 'soul', action: 'list' },
    { wildcard: false, resource: 'synod', action: 'add-operator' },
    { wildcard: false, resource: 'synod', action: 'remove-operator' },
    { wildcard: false, resource: 'synod', action: 'revoke-role' },
  ],
};
// Permissions without synod.remove-operator.
const MY_PERMS_NO_REMOVE_OP = {
  permissions: [
    { wildcard: false, resource: 'soul', action: 'list' },
    { wildcard: false, resource: 'synod', action: 'add-operator' },
    { wildcard: false, resource: 'synod', action: 'grant-role' },
    { wildcard: false, resource: 'synod', action: 'revoke-role' },
  ],
};
// Permissions without synod.revoke-role.
const MY_PERMS_NO_REVOKE_ROLE = {
  permissions: [
    { wildcard: false, resource: 'soul', action: 'list' },
    { wildcard: false, resource: 'synod', action: 'add-operator' },
    { wildcard: false, resource: 'synod', action: 'remove-operator' },
    { wildcard: false, resource: 'synod', action: 'grant-role' },
  ],
};

interface Call {
  url: string;
  method: string;
  body: string | null;
}

function recordingFetch(opts: {
  synods?: typeof SYNODS_SAMPLE;
  myPerms?: typeof MY_PERMS_WILDCARD;
  roles?: typeof ROLES_SAMPLE;
  operators?: typeof OPERATORS_SAMPLE;
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
    // Synod mutations.
    if (/^\/v1\/synods$/.test(url) && method === 'POST') {
      return new Response('', { status: 201 });
    }
    if (/^\/v1\/synods\/[^/]+$/.test(url) && method === 'PATCH') {
      return new Response(null, { status: 204 });
    }
    if (/^\/v1\/synods\/[^/]+$/.test(url) && method === 'DELETE') {
      return new Response('', { status: 204 });
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

describe('SynodsList', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  it('рендерит список Synod-групп из GET /v1/synods', async () => {
    recordingFetch({});
    renderWithProviders(<SynodsList />, '/synods');
    await waitFor(() => {
      expect(screen.getByText('ops-team')).toBeInTheDocument();
      expect(screen.getByText('readonly')).toBeInTheDocument();
    });
  });

  it('empty-state при пустом ответе', async () => {
    recordingFetch({ synods: SYNODS_EMPTY });
    renderWithProviders(<SynodsList />, '/synods');
    await waitFor(() => {
      expect(screen.getByText(/Synod-групп пока нет/i)).toBeInTheDocument();
    });
  });

  it('кнопка «Создать Synod» задизейблена без synod.create', async () => {
    recordingFetch({ myPerms: MY_PERMS_NO_CREATE });
    renderWithProviders(<SynodsList />, '/synods');
    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    const btn = screen.getByTestId('create-synod-btn');
    expect(btn).toBeDisabled();
  });

  it('Create POST /v1/synods — открывает модалку, отправляет запрос, закрывает', async () => {
    const calls = recordingFetch({});
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    await user.click(screen.getByTestId('create-synod-btn'));

    const dialog = await screen.findByRole('dialog', { name: /Создать Synod-группу/i });
    const nameInput = within(dialog).getByTestId('synod-name-input');
    await user.type(nameInput, 'dev-team');
    await user.click(within(dialog).getByRole('button', { name: /^Создать$/ }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/synods' && c.method === 'POST');
      expect(post).toBeDefined();
      expect(post!.body).toContain('"name":"dev-team"');
    });
    // Modal closed.
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Создать Synod-группу/i })).not.toBeInTheDocument();
    });
  });

  it('Create 409 already-exists → pretty-error в модалке', async () => {
    recordingFetch({
      conflict: {
        path: /^\/v1\/synods$/,
        method: 'POST',
        status: 409,
        type: 'https://soul-stack.io/errors/synod-already-exists',
        detail: 'synod ops-team already exists',
      },
    });
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    await user.click(screen.getByTestId('create-synod-btn'));
    const dialog = await screen.findByRole('dialog', { name: /Создать Synod-группу/i });
    await user.type(within(dialog).getByTestId('synod-name-input'), 'ops-team');
    await user.click(within(dialog).getByRole('button', { name: /^Создать$/ }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(/уже существует/i);
    // Modal stays open.
    expect(screen.getByRole('dialog', { name: /Создать Synod-группу/i })).toBeInTheDocument();
  });

  it('Delete: не-builtin → открывает confirm-модалку → DELETE /v1/synods/{name}', async () => {
    const calls = recordingFetch({});
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());

    // ops-team is not builtin -> button is active.
    const delBtn = screen.getByTestId('delete-synod-ops-team');
    expect(delBtn).not.toBeDisabled();
    await user.click(delBtn);

    const dialog = await screen.findByRole('dialog', { name: /Удалить Synod: ops-team/i });
    await user.click(within(dialog).getByRole('button', { name: /^Удалить$/ }));

    await waitFor(() => {
      const del = calls.find((c) => c.url === '/v1/synods/ops-team' && c.method === 'DELETE');
      expect(del).toBeDefined();
    });
  });

  it('Delete builtin → кнопка задизейблена', async () => {
    recordingFetch({});
    renderWithProviders(<SynodsList />, '/synods');
    await waitFor(() => expect(screen.getByText('readonly')).toBeInTheDocument());
    const delBtn = screen.getByTestId('delete-synod-readonly');
    expect(delBtn).toBeDisabled();
  });

  it('Delete 409 builtin → pretty-error в confirm-модалке', async () => {
    recordingFetch({
      conflict: {
        path: /^\/v1\/synods\/ops-team$/,
        method: 'DELETE',
        status: 409,
        type: 'https://soul-stack.io/errors/synod-builtin',
        detail: 'synod ops-team is builtin',
      },
    });
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    await user.click(screen.getByTestId('delete-synod-ops-team'));
    const dialog = await screen.findByRole('dialog', { name: /Удалить Synod: ops-team/i });
    await user.click(within(dialog).getByRole('button', { name: /^Удалить$/ }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(/builtin/i);
  });

  it('Delete 409 would-lock-out-cluster → self-lockout pretty-error', async () => {
    recordingFetch({
      conflict: {
        path: /^\/v1\/synods\/ops-team$/,
        method: 'DELETE',
        status: 409,
        type: 'https://soul-stack.io/errors/would-lock-out-cluster',
        detail: 'last cluster-admin',
      },
    });
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    await user.click(screen.getByTestId('delete-synod-ops-team'));
    const dialog = await screen.findByRole('dialog', { name: /Удалить Synod: ops-team/i });
    await user.click(within(dialog).getByRole('button', { name: /^Удалить$/ }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(/lock-?out|администратора/i);
  });

  it('Add-operator: POST /v1/synods/{name}/operators с {aid} (typeahead-выбор)', async () => {
    const calls = recordingFetch({});
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    await user.click(screen.getByTestId('add-operator-ops-team'));

    const dialog = await screen.findByRole('dialog', { name: /Добавить архонта в ops-team/i });
    // archon-dave is in OPERATORS_SAMPLE and not in ops-team.operators.
    await user.click(within(dialog).getByTestId('add-operator-search'));
    await user.click(await within(dialog).findByTestId('add-operator-option-archon-dave'));
    await user.click(within(dialog).getByTestId('add-operator-submit'));

    await waitFor(() => {
      const post = calls.find(
        (c) => c.url === '/v1/synods/ops-team/operators' && c.method === 'POST',
      );
      expect(post).toBeDefined();
      expect(post!.body).toContain('archon-dave');
    });
  });

  it('[MULTI] AddOperatorModal: несколько выбранных → N POST-ов (fan-out)', async () => {
    const calls = recordingFetch({});
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    await user.click(screen.getByTestId('add-operator-ops-team'));

    const dialog = await screen.findByRole('dialog', { name: /Добавить архонта в ops-team/i });
    await user.click(within(dialog).getByTestId('add-operator-search'));
    await user.click(await within(dialog).findByTestId('add-operator-option-archon-charlie'));
    await user.click(within(dialog).getByTestId('add-operator-option-archon-dave'));
    // Both selected -- chips rendered.
    expect(within(dialog).getByTestId('add-operator-chip-archon-charlie')).toBeInTheDocument();
    expect(within(dialog).getByTestId('add-operator-chip-archon-dave')).toBeInTheDocument();

    await user.click(within(dialog).getByTestId('add-operator-submit'));

    await waitFor(() => {
      const posts = calls.filter(
        (c) => c.url === '/v1/synods/ops-team/operators' && c.method === 'POST',
      );
      expect(posts.length).toBe(2);
      const bodies = posts.map((p) => p.body ?? '').join('|');
      expect(bodies).toContain('archon-charlie');
      expect(bodies).toContain('archon-dave');
    });
  });

  it('[PARTIAL] AddOperatorModal: частичный провал — модалка открыта, показан упавший aid', async () => {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : null;
      calls.push({ url, method, body });
      if (url.startsWith('/v1/me/permissions')) {
        return new Response(JSON.stringify(MY_PERMS_WILDCARD), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith('/v1/synods') && method === 'GET') {
        return new Response(JSON.stringify(SYNODS_SAMPLE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith('/v1/operators') && method === 'GET') {
        return new Response(JSON.stringify(OPERATORS_SAMPLE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (/^\/v1\/synods\/[^/]+\/operators$/.test(url) && method === 'POST') {
        // archon-dave fails with 409, archon-charlie -- succeeds.
        if (body && body.includes('archon-dave')) {
          return new Response(
            JSON.stringify({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'nope' }),
            { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
          );
        }
        return new Response('', { status: 201 });
      }
      return new Response('{}', { status: 599 });
    });

    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    await user.click(screen.getByTestId('add-operator-ops-team'));

    const dialog = await screen.findByRole('dialog', { name: /Добавить архонта в ops-team/i });
    await user.click(within(dialog).getByTestId('add-operator-search'));
    await user.click(await within(dialog).findByTestId('add-operator-option-archon-charlie'));
    await user.click(within(dialog).getByTestId('add-operator-option-archon-dave'));
    await user.click(within(dialog).getByTestId('add-operator-submit'));

    const partial = await within(dialog).findByTestId('add-operator-partial');
    expect(partial).toHaveTextContent('archon-dave');
    // Modal did not close after partial failure.
    expect(
      screen.getByRole('dialog', { name: /Добавить архонта в ops-team/i }),
    ).toBeInTheDocument();
  });

  it('[ФИЛЬТР] AddOperatorModal: текущие члены группы не появляются в опциях', async () => {
    recordingFetch({});
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    // ops-team has operators: ['archon-alice', 'archon-bob']
    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    await user.click(screen.getByTestId('add-operator-ops-team'));

    const dialog = await screen.findByRole('dialog', { name: /Добавить архонта в ops-team/i });
    await user.click(within(dialog).getByTestId('add-operator-search'));

    // archon-charlie and archon-dave (not in the group) -- in the options.
    expect(
      await within(dialog).findByTestId('add-operator-option-archon-charlie'),
    ).toBeInTheDocument();
    expect(within(dialog).getByTestId('add-operator-option-archon-dave')).toBeInTheDocument();
    // archon-alice, archon-bob (already in the group) and archon-revoked (revoked) -- filtered out.
    expect(within(dialog).queryByTestId('add-operator-option-archon-alice')).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId('add-operator-option-archon-bob')).not.toBeInTheDocument();
    expect(
      within(dialog).queryByTestId('add-operator-option-archon-revoked'),
    ).not.toBeInTheDocument();
  });

  it('[EMPTY-STATE] AddOperatorModal: empty-state и submit disabled если все уже в группе', async () => {
    // ops-team members: archon-alice, archon-bob.
    // Give only alice and bob as operators -- both already in the group.
    const twoOperators = {
      items: [
        { aid: 'archon-alice', display_name: 'Alice', auth_method: 'jwt', revoked_at: null },
        { aid: 'archon-bob', display_name: 'Bob', auth_method: 'jwt', revoked_at: null },
      ],
    };
    recordingFetch({ operators: twoOperators });
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    await user.click(screen.getByTestId('add-operator-ops-team'));

    const dialog = await screen.findByRole('dialog', { name: /Добавить архонта в ops-team/i });
    await user.click(within(dialog).getByTestId('add-operator-search'));
    // Both operators already in the group -> no options, empty-state shown.
    await waitFor(() =>
      expect(within(dialog).getByTestId('add-operator-empty')).toBeInTheDocument(),
    );
    expect(within(dialog).queryByTestId('add-operator-option-archon-alice')).not.toBeInTheDocument();
    // Submit button is disabled (nothing selected).
    expect(within(dialog).getByTestId('add-operator-submit')).toBeDisabled();
  });

  it('Remove-operator: DELETE /v1/synods/{name}/operators/{aid} при клике ×', async () => {
    const calls = recordingFetch({});
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('archon-alice')).toBeInTheDocument());
    const removeBtn = screen.getByRole('button', { name: /убрать archon-alice из группы/i });
    await user.click(removeBtn);

    await waitFor(() => {
      const del = calls.find(
        (c) => c.url === '/v1/synods/ops-team/operators/archon-alice' && c.method === 'DELETE',
      );
      expect(del).toBeDefined();
    });
  });

  it('Grant-role: POST /v1/synods/{name}/roles с {role_name}', async () => {
    const calls = recordingFetch({});
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    await user.click(screen.getByTestId('grant-role-ops-team'));

    const dialog = await screen.findByRole('dialog', { name: /Привязать роль к ops-team/i });
    await user.click(within(dialog).getByTestId('grant-role-search'));
    await user.click(await within(dialog).findByTestId('grant-role-option-soul-operator'));
    await user.click(within(dialog).getByTestId('grant-role-submit'));

    await waitFor(() => {
      const post = calls.find(
        (c) => c.url === '/v1/synods/ops-team/roles' && c.method === 'POST',
      );
      expect(post).toBeDefined();
      expect(post!.body).toContain('soul-operator');
    });
  });

  it('Revoke-role: DELETE /v1/synods/{name}/roles/{role_name} при клике ×', async () => {
    const calls = recordingFetch({});
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    const revokeBtn = screen.getByRole('button', { name: /отвязать роль cluster-admin от группы/i });
    await user.click(revokeBtn);

    await waitFor(() => {
      const del = calls.find(
        (c) => c.url === '/v1/synods/ops-team/roles/cluster-admin' && c.method === 'DELETE',
      );
      expect(del).toBeDefined();
    });
  });

  // --- RBAC row-level guard tests ---

  it('[RBAC] без synod.add-operator кнопка add-operator-<name> disabled + title с noPermAddOp', async () => {
    recordingFetch({ myPerms: MY_PERMS_NO_ADD_OP });
    renderWithProviders(<SynodsList />, '/synods');
    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());

    const btn = screen.getByTestId('add-operator-ops-team');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', expect.stringMatching(/synod\.add-operator/i));
  });

  it('[RBAC] без synod.grant-role кнопка grant-role-<name> disabled + title с noPermGrantRole', async () => {
    recordingFetch({ myPerms: MY_PERMS_NO_GRANT_ROLE });
    renderWithProviders(<SynodsList />, '/synods');
    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());

    const btn = screen.getByTestId('grant-role-ops-team');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', expect.stringMatching(/synod\.grant-role/i));
  });

  it('[RBAC] без synod.remove-operator × на чипе архонта disabled + title с noPermRemoveOp', async () => {
    recordingFetch({ myPerms: MY_PERMS_NO_REMOVE_OP });
    renderWithProviders(<SynodsList />, '/synods');
    await waitFor(() => expect(screen.getByText('archon-alice')).toBeInTheDocument());

    const removeBtn = screen.getByRole('button', { name: /убрать archon-alice из группы/i });
    expect(removeBtn).toBeDisabled();
    expect(removeBtn).toHaveAttribute('title', expect.stringMatching(/synod\.remove-operator/i));
  });

  it('[RBAC] без synod.revoke-role × на чипе роли disabled + title с noPermRevokeRole', async () => {
    recordingFetch({ myPerms: MY_PERMS_NO_REVOKE_ROLE });
    renderWithProviders(<SynodsList />, '/synods');
    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());

    const revokeBtn = screen.getByRole('button', { name: /отвязать роль cluster-admin от группы/i });
    expect(revokeBtn).toBeDisabled();
    expect(revokeBtn).toHaveAttribute('title', expect.stringMatching(/synod\.revoke-role/i));
  });

  it('403 subset-denied на grant-role → pretty-error', async () => {
    recordingFetch({
      conflict: {
        path: /^\/v1\/synods\/ops-team\/roles$/,
        method: 'POST',
        status: 403,
        type: 'https://soul-stack.io/errors/subset-denied',
        detail: 'privilege escalation',
      },
    });
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    await user.click(screen.getByTestId('grant-role-ops-team'));
    const dialog = await screen.findByRole('dialog', { name: /Привязать роль к ops-team/i });
    await user.click(within(dialog).getByTestId('grant-role-search'));
    await user.click(await within(dialog).findByTestId('grant-role-option-soul-operator'));
    await user.click(within(dialog).getByTestId('grant-role-submit'));

    // All assignments failed -> partial-fail block with pretty-error (subset).
    const partial = await within(dialog).findByTestId('grant-role-partial');
    expect(partial).toHaveTextContent('soul-operator');
    expect(partial).toHaveTextContent(/subset|эскалац|права/i);
  });

  // --- #6 Tightening the grant-role contract ---

  it('[КОНТРАКТ] grant-role body содержит именно "role":"soul-operator"', async () => {
    const calls = recordingFetch({});
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    await user.click(screen.getByTestId('grant-role-ops-team'));

    const dialog = await screen.findByRole('dialog', { name: /Привязать роль к ops-team/i });
    await user.click(within(dialog).getByTestId('grant-role-search'));
    await user.click(await within(dialog).findByTestId('grant-role-option-soul-operator'));
    await user.click(within(dialog).getByTestId('grant-role-submit'));

    await waitFor(() => {
      const post = calls.find(
        (c) => c.url === '/v1/synods/ops-team/roles' && c.method === 'POST',
      );
      expect(post).toBeDefined();
      const parsed = JSON.parse(post!.body ?? '{}');
      // SynodGrantRoleRequest contract: field "role", not "role_name".
      expect(parsed).toMatchObject({ role: 'soul-operator' });
    });
  });

  // --- #3 GrantRoleModal availableRoles filter ---

  it('[ФИЛЬТР] GrantRoleModal: уже привязанная роль cluster-admin не появляется в опциях', async () => {
    recordingFetch({});
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    // ops-team already has roles: ['cluster-admin'] -> cluster-admin must be filtered out.
    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    await user.click(screen.getByTestId('grant-role-ops-team'));

    const dialog = await screen.findByRole('dialog', { name: /Привязать роль к ops-team/i });
    await user.click(within(dialog).getByTestId('grant-role-search'));

    // soul-operator (not assigned) -- present in the options.
    expect(await within(dialog).findByTestId('grant-role-option-soul-operator')).toBeInTheDocument();
    // cluster-admin (already assigned) -- absent.
    expect(within(dialog).queryByTestId('grant-role-option-cluster-admin')).not.toBeInTheDocument();
  });

  // --- #4 Inline row-error for remove-operator / revoke-role ---

  it('[ROW-ERROR] remove-operator 409 → ошибка в строке таблицы', async () => {
    recordingFetch({
      conflict: {
        path: /^\/v1\/synods\/ops-team\/operators\/archon-alice$/,
        method: 'DELETE',
        status: 409,
        type: 'https://soul-stack.io/errors/would-lock-out-cluster',
        detail: 'last cluster-admin',
      },
    });
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('archon-alice')).toBeInTheDocument());
    const removeBtn = screen.getByRole('button', { name: /убрать archon-alice из группы/i });
    await user.click(removeBtn);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/lock-?out|администратора/i);
  });

  it('[ROW-ERROR] revoke-role 403 → ошибка в строке таблицы', async () => {
    recordingFetch({
      conflict: {
        path: /^\/v1\/synods\/ops-team\/roles\/cluster-admin$/,
        method: 'DELETE',
        status: 403,
        type: 'https://soul-stack.io/errors/subset-denied',
        detail: 'subset',
      },
    });
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    const revokeBtn = screen.getByRole('button', { name: /отвязать роль cluster-admin от группы/i });
    await user.click(revokeBtn);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/subset|эскалац|права/i);
  });

  // --- #5 SynodsList states: isLoading + synodsQ.error ---

  it('[STATE] isLoading: показывает loading-индикатор пока данные грузятся', () => {
    let resolve: ((v: Response) => void) | undefined;
    vi.stubGlobal('fetch', () =>
      new Promise<Response>((r) => {
        resolve = r;
      }));

    renderWithProviders(<SynodsList />, '/synods');
    expect(screen.getByText(/Загрузка/i)).toBeInTheDocument();

    resolve!(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });

  // --- Edit Synod guard tests ---

  it('[EDIT] кнопка edit-synod-ops-team открывает модалку с именем и описанием', async () => {
    recordingFetch({});
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    await user.click(screen.getByTestId('edit-synod-ops-team'));

    const dialog = await screen.findByRole('dialog', { name: /Редактировать Synod: ops-team/i });
    // name shown as read-only
    expect(within(dialog).getByTestId('edit-synod-name-readonly')).toHaveValue('ops-team');
    // description pre-filled
    expect(within(dialog).getByTestId('edit-synod-description-input')).toHaveValue('Operations team');
  });

  it('[EDIT] PATCH /v1/synods/{name} шлёт { description }', async () => {
    const calls = recordingFetch({});
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    await user.click(screen.getByTestId('edit-synod-ops-team'));

    const dialog = await screen.findByRole('dialog', { name: /Редактировать Synod: ops-team/i });
    const textarea = within(dialog).getByTestId('edit-synod-description-input');
    await user.clear(textarea);
    await user.type(textarea, 'Updated description');
    await user.click(within(dialog).getByRole('button', { name: /^Сохранить$/ }));

    await waitFor(() => {
      const patch = calls.find((c) => c.url === '/v1/synods/ops-team' && c.method === 'PATCH');
      expect(patch).toBeDefined();
      const parsed = JSON.parse(patch!.body ?? '{}');
      expect(parsed).toMatchObject({ description: 'Updated description' });
    });
    // Modal closed after success.
    await waitFor(
      () => {
        expect(screen.queryByRole('dialog', { name: /Редактировать Synod/i })).not.toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it('[EDIT][RBAC] без synod.update кнопка edit-synod disabled + title с noPermUpdate', async () => {
    recordingFetch({ myPerms: MY_PERMS_NO_UPDATE });
    renderWithProviders(<SynodsList />, '/synods');

    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    const btn = screen.getByTestId('edit-synod-ops-team');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', expect.stringMatching(/synod\.update/i));
  });

  it('[EDIT] 422 от PATCH показывается как ошибка в модалке', async () => {
    recordingFetch({
      conflict: {
        path: /^\/v1\/synods\/ops-team$/,
        method: 'PATCH',
        status: 422,
        detail: 'description is too long',
      },
    });
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    await user.click(screen.getByTestId('edit-synod-ops-team'));

    const dialog = await screen.findByRole('dialog', { name: /Редактировать Synod: ops-team/i });
    await user.click(within(dialog).getByRole('button', { name: /^Сохранить$/ }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(/description is too long|валид/i);
    // Modal did not close.
    expect(screen.getByRole('dialog', { name: /Редактировать Synod/i })).toBeInTheDocument();
  });

  it('[EDIT] name read-only — хинт "имя нельзя изменить" отображается', async () => {
    recordingFetch({});
    renderWithProviders(<SynodsList />, '/synods');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-team')).toBeInTheDocument());
    await user.click(screen.getByTestId('edit-synod-ops-team'));

    const dialog = await screen.findByRole('dialog', { name: /Редактировать Synod/i });
    expect(within(dialog).getByTestId('edit-synod-name-hint')).toHaveTextContent(/имя нельзя изменить/i);
  });

  it('[STATE] synodsQ.error: показывает errorBox при 500 от GET /v1/synods', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.startsWith('/v1/me/permissions') && method === 'GET') {
        return new Response(JSON.stringify(MY_PERMS_WILDCARD), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ type: 'about:blank', title: 'Error', status: 500, detail: 'server error' }),
        { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
      );
    });

    renderWithProviders(<SynodsList />, '/synods');
    await waitFor(() => {
      expect(screen.getByText(/500/)).toBeInTheDocument();
    });
  });
});
