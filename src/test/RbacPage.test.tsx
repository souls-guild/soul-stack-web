import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { RbacPage } from '../pages/rbac/RbacPage';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const SAMPLE = {
  items: [
    {
      name: 'cluster-admin',
      description: 'Полные права',
      builtin: true,
      permissions: ['*'],
      operators: ['archon-bootstrap', 'archon-alice'],
    },
    {
      name: 'soul-operator',
      description: 'Управление Soul-ами',
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

// Гибкий fetch-mock с записью вызовов для CRUD-проверок. installFetchMock
// удобнее для чистого read, но здесь нужно отделять GET/POST/PATCH/DELETE
// на одних и тех же путях и логировать body.
function recordingFetch(opts: {
  rolesList: typeof SAMPLE;
  operators?: typeof OPERATORS_SAMPLE;
  permissions?: typeof PERMISSIONS_SAMPLE;
  // Конфликт-симулятор: если url == path и method == method — отдадим status и detail.
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
    // Autocomplete endpoints для scope-builder (graceful empty если не нужно).
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
    // CRUD на ролях — все 204 без тела.
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
  it('рендерит список ролей из /v1/roles', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/roles', body: SAMPLE }]);
    renderWithProviders(<RbacPage />, '/rbac');
    expect(screen.getByRole('heading', { name: /RBAC/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('cluster-admin')).toBeInTheDocument();
      expect(screen.getByText('soul-operator')).toBeInTheDocument();
    });
  });

  it('переключение на Role permissions показывает permission-чипы', async () => {
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

  it('Archon assignments сводит роли по AID', async () => {
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

  it('empty-state при пустом ответе', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/roles', body: { items: [] } }]);
    renderWithProviders(<RbacPage />, '/rbac');
    await waitFor(() => {
      expect(screen.getByText(/Ролей в кластере нет/i)).toBeInTheDocument();
    });
  });

  it('Create role: открытие модалки → POST /v1/roles с name + permissions', async () => {
    const calls = recordingFetch({ rolesList: SAMPLE });
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Создать роль/i }));
    const dialog = await screen.findByRole('dialog', { name: /Создать роль/i });
    const nameInput = within(dialog).getByPlaceholderText('soul-operator');
    await user.type(nameInput, 'log-reader');
    // Каталог permissions подгружается из GET /v1/permissions — отмечаем audit.read.
    const auditRead = await within(dialog).findByRole('checkbox', { name: 'audit.read' });
    await user.click(auditRead);
    await user.click(within(dialog).getByRole('button', { name: /^Создать$/ }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/roles' && c.method === 'POST');
      expect(post).toBeDefined();
      expect(post!.body).toContain('"name":"log-reader"');
      expect(post!.body).toContain('"audit.read"');
    });
  });

  it('Create role: 201 с пустым телом не падает на .json() и закрывает модалку', async () => {
    // Регрессия: role.create отдаёт 201 без тела (контракт backend).
    // Клиент не должен звать .json() на пустом потоке («Unexpected end of
    // JSON input»). Успех = mutation отрабатывает onSuccess → модалка закрыта.
    recordingFetch({ rolesList: SAMPLE });
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Создать роль/i }));
    const dialog = await screen.findByRole('dialog', { name: /Создать роль/i });
    await user.type(within(dialog).getByPlaceholderText('soul-operator'), 'log-reader');
    await user.click(within(dialog).getByRole('button', { name: /^Создать$/ }));

    // onSuccess закрывает модалку; ошибки парсинга тела нет.
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Создать роль/i })).not.toBeInTheDocument();
    });
  });

  it('Create role 409 already-exists → human-readable error', async () => {
    recordingFetch({
      rolesList: SAMPLE,
      conflict: {
        path: /^\/v1\/roles$/,
        method: 'POST',
        status: 409,
        type: 'https://soul-stack.io/errors/role-already-exists',
        detail: 'role log-reader already exists',
      },
    });
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Создать роль/i }));
    const dialog = await screen.findByRole('dialog', { name: /Создать роль/i });
    await user.type(within(dialog).getByPlaceholderText('soul-operator'), 'log-reader');
    await user.click(within(dialog).getByRole('button', { name: /^Создать$/ }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(/уже существует|already exists/i);
    // Модалка остаётся открытой — оператор видит ошибку.
    expect(screen.getByRole('dialog', { name: /Создать роль/i })).toBeInTheDocument();
  });

  it('Edit permissions: PATCH /v1/roles/{name}/permissions с новым набором', async () => {
    const calls = recordingFetch({ rolesList: SAMPLE });
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('soul-operator')).toBeInTheDocument());

    // Edit-кнопка соседствует с soul-operator (вторая строка таблицы).
    const editButtons = screen.getAllByRole('button', { name: /редактировать permissions/i });
    // soul-operator — вторая роль; editButtons[1] соответствует ей.
    await user.click(editButtons[1]);

    const dialog = await screen.findByRole('dialog', { name: /Permissions: soul-operator/i });
    // Каталог из GET /v1/permissions: снимаем soul.exec, отмечаем incarnation.read.
    const soulExec = await within(dialog).findByRole('checkbox', { name: 'soul.exec' });
    expect(soulExec).toBeChecked();
    await user.click(soulExec);
    await user.click(within(dialog).getByRole('checkbox', { name: 'incarnation.read' }));
    await user.click(within(dialog).getByRole('button', { name: /Сохранить/i }));

    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/permissions'));
      expect(patch).toBeDefined();
      expect(patch!.url).toBe('/v1/roles/soul-operator/permissions');
      // soul.exec удалён, incarnation.read добавлен.
      expect(patch!.body).toContain('incarnation.read');
      expect(patch!.body).not.toContain('soul.exec');
    });
  });

  it('Edit permissions builtin: 409 role-builtin → pretty-error', async () => {
    recordingFetch({
      rolesList: SAMPLE,
      conflict: {
        path: /\/v1\/roles\/cluster-admin\/permissions$/,
        method: 'PATCH',
        status: 409,
        type: 'https://soul-stack.io/errors/role-builtin',
        detail: 'cluster-admin is builtin',
      },
    });
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());

    // Edit на cluster-admin (первая роль). Кнопка disabled-у нас не выставлена
    // на builtin (заблокирован сабмит внутри), так что попадаем в Modal.
    const editButtons = screen.getAllByRole('button', { name: /редактировать permissions/i });
    await user.click(editButtons[0]);
    const dialog = await screen.findByRole('dialog', { name: /Permissions: cluster-admin/i });
    // Сабмит-кнопка disabled для builtin — проверим явно.
    expect(within(dialog).getByRole('button', { name: /Сохранить/i })).toBeDisabled();
    // И warning «редактирование заблокировано» виден.
    expect(within(dialog).getByText(/Редактирование заблокировано/i)).toBeInTheDocument();
  });

  it('Delete role: confirm-modal → DELETE /v1/roles/{name}', async () => {
    const calls = recordingFetch({ rolesList: SAMPLE });
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('soul-operator')).toBeInTheDocument());

    // Delete у soul-operator (не-builtin); cluster-admin disabled.
    const deleteButtons = screen.getAllByRole('button', { name: /удалить роль/i });
    // deleteButtons[0] — cluster-admin (builtin, disabled), [1] — soul-operator.
    expect(deleteButtons[0]).toBeDisabled();
    await user.click(deleteButtons[1]);

    const dialog = await screen.findByRole('dialog', { name: /Удалить роль: soul-operator/i });
    // Видны операторы, которые потеряют permissions.
    expect(within(dialog).getByText(/потеряет/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /^Удалить$/ }));

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

    const deleteButtons = screen.getAllByRole('button', { name: /удалить роль/i });
    await user.click(deleteButtons[1]);
    const dialog = await screen.findByRole('dialog', { name: /Удалить роль: soul-operator/i });
    await user.click(within(dialog).getByRole('button', { name: /^Удалить$/ }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(/lock-?out|self-lockout|админ/i);
    // Модалка не закрывается — diaolog ещё в DOM.
    expect(screen.getByRole('dialog', { name: /Удалить роль: soul-operator/i })).toBeInTheDocument();
  });

  it('Assign role: POST /v1/roles/{name}/operators c {aid}', async () => {
    const calls = recordingFetch({ rolesList: SAMPLE });
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /Archon assignments/i }));
    // Дожидаемся, пока появится archon-bob (у которого ролей нет).
    await waitFor(() => expect(screen.getByText('archon-bob')).toBeInTheDocument());

    const assignButtons = screen.getAllByRole('button', { name: /назначить роль/i });
    // archon-alice, archon-bob, archon-bootstrap — кнопок 3; выбираем archon-bob.
    const bobBtn = assignButtons.find((b) => b.getAttribute('aria-label') === 'назначить роль archon-bob');
    await user.click(bobBtn!);

    const dialog = await screen.findByRole('dialog', { name: /Назначить роль: archon-bob/i });
    await user.selectOptions(within(dialog).getByLabelText('role'), 'soul-operator');
    await user.click(within(dialog).getByRole('button', { name: /^Назначить$/ }));

    await waitFor(() => {
      const post = calls.find(
        (c) => c.method === 'POST' && c.url === '/v1/roles/soul-operator/operators',
      );
      expect(post).toBeDefined();
      expect(post!.body).toContain('archon-bob');
    });
  });

  it('Revoke role (× на чипе): DELETE /v1/roles/{name}/operators/{aid}', async () => {
    const calls = recordingFetch({ rolesList: SAMPLE });
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /Archon assignments/i }));
    await waitFor(() => expect(screen.getByText('archon-alice')).toBeInTheDocument());

    // Снимаем archon-alice с soul-operator. Чип с × имеет aria-label
    // «снять archon-alice с роли soul-operator».
    const x = screen.getByRole('button', { name: /снять archon-alice с роли soul-operator/i });
    await user.click(x);

    await waitFor(() => {
      const del = calls.find(
        (c) => c.method === 'DELETE' && c.url === '/v1/roles/soul-operator/operators/archon-alice',
      );
      expect(del).toBeDefined();
    });
  });

  it('Permissions-picker: рендерит каталог из GET /v1/permissions сгруппированно', async () => {
    recordingFetch({ rolesList: SAMPLE });
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Создать роль/i }));
    const dialog = await screen.findByRole('dialog', { name: /Создать роль/i });
    // Чекбоксы из каталога: resource.action как полное право.
    expect(await within(dialog).findByRole('checkbox', { name: 'soul.list' })).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'soul.read' })).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'incarnation.run' })).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'audit.read' })).toBeInTheDocument();
    // resource-группы видны как legend.
    expect(within(dialog).getByText('incarnation')).toBeInTheDocument();
  });

  it('Permissions-picker: каталог недоступен (404) → graceful, права роли сохраняются', async () => {
    // /v1/permissions отдаёт 599 (нет хэндлера) — recordingFetch с пустым каталогом.
    const calls = recordingFetch({ rolesList: SAMPLE, permissions: { items: [] } });
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('soul-operator')).toBeInTheDocument());

    const editButtons = screen.getAllByRole('button', { name: /редактировать permissions/i });
    await user.click(editButtons[1]);
    const dialog = await screen.findByRole('dialog', { name: /Permissions: soul-operator/i });
    // Каталог пуст — hint виден, существующие права как preserved-чипы.
    expect(within(dialog).getByText(/Каталог permissions недоступен/i)).toBeInTheDocument();
    expect(within(dialog).getByText('soul.exec')).toBeInTheDocument();
    // Save без каталога не дропает существующие права (replace-семантика).
    await user.click(within(dialog).getByRole('button', { name: /Сохранить/i }));
    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/permissions'));
      expect(patch).toBeDefined();
      expect(patch!.body).toContain('soul.exec');
    });
  });

  it('Scope-builder: отмечает incarnation.run без scope → голый "incarnation.run"', async () => {
    // incarnation.run имеет selector_keys: [] → scope-пикер не показывается.
    const calls = recordingFetch({
      rolesList: { items: [{ name: 'test-role', description: '', builtin: false, permissions: [], operators: [] }] },
    });
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('test-role')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Создать роль/i }));
    const dialog = await screen.findByRole('dialog', { name: /Создать роль/i });
    await user.type(within(dialog).getByPlaceholderText('soul-operator'), 'scope-test');

    const cb = await within(dialog).findByRole('checkbox', { name: 'incarnation.run' });
    await user.click(cb);
    await user.click(within(dialog).getByRole('button', { name: /^Создать$/ }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/roles' && c.method === 'POST');
      expect(post).toBeDefined();
      // Должен быть голый пермишн без " on ..."
      expect(post!.body).toContain('"incarnation.run"');
      expect(post!.body).not.toContain(' on ');
    });
  });

  it('Scope-builder: soul.list + scope coven=ops → "soul.list on coven=ops"', async () => {
    // soul.list имеет selector_keys: ['coven', 'sid'] → scope-пикер появляется.
    const calls = recordingFetch({
      rolesList: { items: [{ name: 'scoped-role', description: '', builtin: false, permissions: [], operators: [] }] },
    });
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('scoped-role')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Создать роль/i }));
    const dialog = await screen.findByRole('dialog', { name: /Создать роль/i });
    await user.type(within(dialog).getByPlaceholderText('soul-operator'), 'scoped-role-x');

    const cb = await within(dialog).findByRole('checkbox', { name: 'soul.list' });
    await user.click(cb);

    // Выбрать scope-ключ = coven (scope-пикер появляется после checked)
    const keySelect = await within(dialog).findByRole('combobox', { name: /ключ селектора scope/i });
    await user.selectOptions(keySelect, 'coven');

    // Ввести значение (input появляется после выбора ключа)
    const valueInput = await within(dialog).findByRole('textbox', { name: /значение coven/i });
    await user.type(valueInput, 'ops');

    await user.click(within(dialog).getByRole('button', { name: /^Создать$/ }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/roles' && c.method === 'POST');
      expect(post).toBeDefined();
      expect(post!.body).toContain('soul.list on coven=ops');
    });
  });

  it('Scope-builder: парсинг существующего scoped-права роли → checked чекбокс', async () => {
    // Роль имеет scoped-право — base soul.list есть в каталоге → checked чекбокс.
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
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('scoped-role')).toBeInTheDocument());

    const editButtons = screen.getAllByRole('button', { name: /редактировать permissions/i });
    await user.click(editButtons[0]);
    const dialog = await screen.findByRole('dialog', { name: /Permissions: scoped-role/i });

    // Дожидаемся загрузки каталога — incarnation.run как индикатор (findByRole с timeout).
    const incRun = await within(dialog).findByRole('checkbox', { name: 'incarnation.run' });
    expect(incRun).toBeChecked();

    // soul.list on coven=ops — base в каталоге → checked чекбокс.
    // Accessible name включает scope-badge текст ("soul.list coven=ops"), ищем по regex.
    const soulList = await within(dialog).findByRole('checkbox', { name: /soul\.list/ });
    expect(soulList).toBeChecked();
  });

  // ── Guard-тесты: кликабельные ссылки ──────────────────────────────────────

  it('[LINKS] AID в Archon assignments рендерятся ссылками на /archons/:aid', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/roles', body: SAMPLE },
      { method: 'GET', url: '/v1/operators', body: OPERATORS_SAMPLE },
    ]);
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();

    // Переходим на таб Archon assignments.
    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /Archon assignments/i }));

    // Ждём появления архонтов.
    await waitFor(() => expect(screen.getByText('archon-alice')).toBeInTheDocument());

    // Каждый AID — ссылка с правильным href.
    const linkAlice = screen.getByRole('link', { name: 'archon-alice' });
    expect(linkAlice).toHaveAttribute('href', '/archons/archon-alice');

    const linkBootstrap = screen.getByRole('link', { name: 'archon-bootstrap' });
    expect(linkBootstrap).toHaveAttribute('href', '/archons/archon-bootstrap');

    const linkBob = screen.getByRole('link', { name: 'archon-bob' });
    expect(linkBob).toHaveAttribute('href', '/archons/archon-bob');
  });

  it('[LINKS] AID с спецсимволами корректно URL-кодируется', async () => {
    // AID c «+» или пробелом — encodeURIComponent не даёт сломанный href.
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
