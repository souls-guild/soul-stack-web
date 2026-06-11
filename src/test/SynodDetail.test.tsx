import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { SynodDetail } from '../pages/synods/SynodDetail';
import { tokenStore } from '../api/tokenStore';

// Тестовые данные.
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
  it('рендерит секцию Members: список архонтов из ops-team', async () => {
    recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ops-team');
    await waitFor(() => {
      expect(screen.getByText('archon-alice')).toBeInTheDocument();
      expect(screen.getByText('archon-bob')).toBeInTheDocument();
    });
    // Секция members присутствует.
    expect(screen.getByRole('region', { name: /members/i })).toBeInTheDocument();
  });

  it('рендерит секцию Roles: привязанные роли ops-team', async () => {
    recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ops-team');
    await waitFor(() => {
      expect(screen.getByText('cluster-admin')).toBeInTheDocument();
      expect(screen.getByText('viewer')).toBeInTheDocument();
    });
    expect(screen.getByRole('region', { name: /group-roles/i })).toBeInTheDocument();
  });

  it('отображает фильтрацию по :name — переходим на /synods/empty-group', async () => {
    recordingFetch({});
    renderWithProviders(withRoute(), '/synods/empty-group');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'empty-group' })).toBeInTheDocument();
    });
    // archon-alice из ops-team не должна быть видна.
    expect(screen.queryByText('archon-alice')).not.toBeInTheDocument();
  });

  it('empty-state members: noMembers при пустом operators', async () => {
    recordingFetch({});
    renderWithProviders(withRoute(), '/synods/empty-group');
    await waitFor(() => {
      expect(screen.getByText(/Участников нет/i)).toBeInTheDocument();
    });
  });

  it('empty-state roles: noRoles при пустом roles', async () => {
    recordingFetch({});
    renderWithProviders(withRoute(), '/synods/empty-group');
    await waitFor(() => {
      expect(screen.getByText(/Ролей в группе нет/i)).toBeInTheDocument();
    });
  });

  it('isLoading: показывает loading-индикатор пока данные грузятся', async () => {
    // Fetch никогда не резолвится — проверяем состояние loading.
    let resolve: ((v: Response) => void) | undefined;
    vi.stubGlobal('fetch', () =>
      new Promise<Response>((r) => {
        resolve = r;
      }));

    renderWithProviders(withRoute(), '/synods/ops-team');
    expect(screen.getByText(/Загрузка/i)).toBeInTheDocument();

    // Разрешаем промис чтобы не утечь.
    resolve!(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });

  it('error: показывает errorBox при ошибке GET /v1/synods', async () => {
    recordingFetch({ synodsStatus: 500 });
    renderWithProviders(withRoute(), '/synods/ops-team');
    await waitFor(() => {
      // errorBox содержит статус ошибки.
      expect(screen.getByText(/500/)).toBeInTheDocument();
    });
  });

  it('synod-не-найден: показывает errors:synodNotFound когда name не в items', async () => {
    recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ghost-group');
    await waitFor(() => {
      expect(screen.getByText(/Synod не найден/i)).toBeInTheDocument();
    });
  });

  it('Remove-operator: DELETE /v1/synods/{name}/operators/{aid} по кнопке ×', async () => {
    const calls = recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ops-team');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('archon-alice')).toBeInTheDocument());
    const removeBtn = screen.getByRole('button', { name: /убрать archon-alice из группы/i });
    await user.click(removeBtn);

    await waitFor(() => {
      const del = calls.find(
        (c) =>
          c.url === '/v1/synods/ops-team/operators/archon-alice' && c.method === 'DELETE',
      );
      expect(del).toBeDefined();
    });
  });

  it('Revoke-role: DELETE /v1/synods/{name}/roles/{role} по кнопке ×', async () => {
    const calls = recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ops-team');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());
    const revokeBtn = screen.getByRole('button', { name: /отвязать роль cluster-admin от группы/i });
    await user.click(revokeBtn);

    await waitFor(() => {
      const del = calls.find(
        (c) =>
          c.url === '/v1/synods/ops-team/roles/cluster-admin' && c.method === 'DELETE',
      );
      expect(del).toBeDefined();
    });
  });

  it('Remove-operator ошибка 409: inline memberError показывается в секции members', async () => {
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
    const removeBtn = screen.getByRole('button', { name: /убрать archon-alice из группы/i });
    await user.click(removeBtn);

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/lock-?out|администратора/i);
    });
  });

  it('Revoke-role ошибка 403: inline roleError показывается в секции roles', async () => {
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
    const revokeBtn = screen.getByRole('button', { name: /отвязать роль cluster-admin от группы/i });
    await user.click(revokeBtn);

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/subset|эскалац|права/i);
    });
  });

  it('[RBAC] без synod.add-operator кнопка «Добавить архонта» не рендерится', async () => {
    recordingFetch({ myPerms: MY_PERMS_READONLY });
    renderWithProviders(withRoute(), '/synods/ops-team');
    await waitFor(() => expect(screen.getByText('archon-alice')).toBeInTheDocument());
    expect(screen.queryByTestId('add-operator-btn')).not.toBeInTheDocument();
  });

  it('[RBAC] без synod.grant-role кнопка «Привязать роль» не рендерится', async () => {
    recordingFetch({ myPerms: MY_PERMS_READONLY });
    renderWithProviders(withRoute(), '/synods/ops-team');
    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());
    expect(screen.queryByTestId('grant-role-btn')).not.toBeInTheDocument();
  });

  // --- Edit guard-тесты ---

  it('[EDIT] кнопка edit-synod-btn открывает EditSynodModal с именем и описанием', async () => {
    const { within: w } = await import('@testing-library/react');
    recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ops-team');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ops-team' })).toBeInTheDocument());
    await user.click(screen.getByTestId('edit-synod-btn'));

    const dialog = await screen.findByRole('dialog', { name: /Редактировать Synod: ops-team/i });
    expect(w(dialog).getByTestId('edit-synod-name-readonly')).toHaveValue('ops-team');
    expect(w(dialog).getByTestId('edit-synod-description-input')).toHaveValue('Operations team');
  });

  it('[EDIT] PATCH /v1/synods/{name} шлёт { description }', async () => {
    const { within: w } = await import('@testing-library/react');
    const calls = recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ops-team');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ops-team' })).toBeInTheDocument());
    await user.click(screen.getByTestId('edit-synod-btn'));

    const dialog = await screen.findByRole('dialog', { name: /Редактировать Synod: ops-team/i });
    const textarea = w(dialog).getByTestId('edit-synod-description-input');
    await user.clear(textarea);
    await user.type(textarea, 'New description');
    await user.click(w(dialog).getByRole('button', { name: /^Сохранить$/ }));

    await waitFor(() => {
      const patch = calls.find((c) => c.url === '/v1/synods/ops-team' && c.method === 'PATCH');
      expect(patch).toBeDefined();
      const parsed = JSON.parse(patch!.body ?? '{}');
      expect(parsed).toMatchObject({ description: 'New description' });
    });
  });

  it('[EDIT][RBAC] без synod.update кнопка edit-synod-btn disabled', async () => {
    recordingFetch({ myPerms: MY_PERMS_NO_UPDATE });
    renderWithProviders(withRoute(), '/synods/ops-team');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ops-team' })).toBeInTheDocument());
    const btn = screen.getByTestId('edit-synod-btn');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', expect.stringMatching(/synod\.update/i));
  });

  it('[EDIT] 422 от PATCH показывается в модалке', async () => {
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

    const dialog = await screen.findByRole('dialog', { name: /Редактировать Synod: ops-team/i });
    await user.click(w(dialog).getByRole('button', { name: /^Сохранить$/ }));

    const alert = await w(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(/description too long|валид/i);
    expect(screen.getByRole('dialog', { name: /Редактировать Synod/i })).toBeInTheDocument();
  });

  // ── Guard-тесты: кликабельные ссылки ──────────────────────────────────────

  it('[LINKS] участники-архоны рендерятся ссылками на /archons/:aid', async () => {
    recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ops-team');

    await waitFor(() => expect(screen.getByText('archon-alice')).toBeInTheDocument());

    const linkAlice = screen.getByRole('link', { name: 'archon-alice' });
    expect(linkAlice).toHaveAttribute('href', '/archons/archon-alice');

    const linkBob = screen.getByRole('link', { name: 'archon-bob' });
    expect(linkBob).toHaveAttribute('href', '/archons/archon-bob');
  });

  it('[LINKS] роли группы рендерятся ссылками на /rbac', async () => {
    recordingFetch({});
    renderWithProviders(withRoute(), '/synods/ops-team');

    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());

    const linkAdmin = screen.getByRole('link', { name: 'cluster-admin' });
    expect(linkAdmin).toHaveAttribute('href', '/rbac');

    const linkViewer = screen.getByRole('link', { name: 'viewer' });
    expect(linkViewer).toHaveAttribute('href', '/rbac');
  });

  it('[LINKS] при пустых секциях ссылок нет (empty-group)', async () => {
    recordingFetch({});
    renderWithProviders(withRoute(), '/synods/empty-group');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'empty-group' })).toBeInTheDocument());

    // Нет ссылок на архонтов и роли в пустой группе.
    expect(screen.queryByRole('link', { name: /archon-/i })).not.toBeInTheDocument();
  });
});
