import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { ArchonsList } from '../pages/archons/ArchonsList';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const SAMPLE_LIST = {
  items: [
    {
      aid: 'archon-bootstrap',
      display_name: 'Bootstrap Archon',
      auth_method: 'jwt',
      created_at: '2026-05-01T00:00:00Z',
      created_by_aid: null,
      revoked_at: null,
      bootstrap_initial: true,
    },
    {
      aid: 'archon-alice',
      display_name: 'Alice Ops',
      auth_method: 'jwt',
      created_at: '2026-05-10T10:00:00Z',
      created_by_aid: 'archon-bootstrap',
      revoked_at: null,
      bootstrap_initial: false,
    },
    {
      aid: 'archon-old',
      display_name: 'Old Ops',
      auth_method: 'jwt',
      created_at: '2026-04-01T00:00:00Z',
      created_by_aid: 'archon-bootstrap',
      revoked_at: '2026-05-20T00:00:00Z',
      bootstrap_initial: false,
    },
  ],
  offset: 0,
  limit: 50,
  total: 3,
};

describe('ArchonsList', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит таблицу Архонтов из GET /v1/operators', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: SAMPLE_LIST },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    await waitFor(() => {
      // AID — это link в первой колонке; в других строках archon-bootstrap
      // встречается как created_by (mono-text). Считаем только links.
      expect(screen.getByRole('link', { name: 'archon-bootstrap' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'archon-alice' })).toBeInTheDocument();
    });
    // Badge initial для bootstrap-Архонта.
    expect(screen.getByText('initial')).toBeInTheDocument();
  });

  it('rendering — clickable AID-link на detail', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: SAMPLE_LIST },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    await waitFor(() => {
      expect(screen.getByText('archon-alice')).toBeInTheDocument();
    });
    const link = screen.getByRole('link', { name: 'archon-alice' });
    expect(link).toHaveAttribute('href', '/archons/archon-alice');
  });

  it('фильтры auth_method + hide-revoked попадают в query', async () => {
    let lastUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      lastUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(JSON.stringify(SAMPLE_LIST), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/Auth method/i), 'jwt');
    // Default: Hide revoked = ON → revoked param НЕ передаётся (server-default
    // = только активные). Снимаем чекбокс — должен появиться revoked=true.
    await user.click(screen.getByLabelText(/Hide revoked/i));
    await waitFor(() => {
      expect(lastUrl).toMatch(/auth_method=jwt/);
      expect(lastUrl).toMatch(/revoked=true/);
    });
  });

  it('Hide revoked default ON: revoked-Архонт скрыт + counter X of Y', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: SAMPLE_LIST },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'archon-alice' })).toBeInTheDocument();
    });
    // archon-old (revoked_at != null) — скрыт по умолчанию.
    expect(screen.queryByRole('link', { name: 'archon-old' })).not.toBeInTheDocument();
    // Counter: видимых 2, всего 3.
    expect(screen.getByLabelText(/счётчик архонтов/i)).toHaveTextContent(/Showing 2 of 3/);
  });

  it('Hide revoked OFF: revoked-Архонт виден с red chip + Revoke disabled', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: SAMPLE_LIST },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'archon-alice' })).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText(/Hide revoked/i));
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'archon-old' })).toBeInTheDocument();
    });
    // Chip «revoked» рядом с aid.
    expect(screen.getByText('revoked')).toBeInTheDocument();
    // Revoke и Issue token для archon-old (последний в таблице) — disabled.
    // testid устойчив к locale (button-label зависит от выбранного языка).
    expect(screen.getByTestId('revoke-archon-old')).toBeDisabled();
    expect(screen.getByTestId('issue-token-archon-old')).toBeDisabled();
    // Counter: 3 of 3.
    expect(screen.getByLabelText(/счётчик архонтов/i)).toHaveTextContent(/Showing 3 of 3/);
  });

  it('per-row Revoke через Modal → POST /v1/operators/{aid}/revoke', async () => {
    const calls: Array<{ url: string; method: string; body: string | null }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : null;
      calls.push({ url, method, body });
      if (url.startsWith('/v1/operators') && method === 'GET') {
        return new Response(JSON.stringify(SAMPLE_LIST), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.match(/\/v1\/operators\/.+\/revoke/) && method === 'POST') {
        return new Response('', { status: 204 });
      }
      return new Response('{}', { status: 599 });
    }) as typeof fetch;

    renderWithProviders(<ArchonsList />, '/archons');
    await waitFor(() => {
      // Hide revoked default ON → archon-old отфильтрован, видимы 2 строки.
      expect(screen.getByTestId('revoke-archon-alice')).toBeInTheDocument();
    });
    const user = userEvent.setup();
    await user.click(screen.getByTestId('revoke-archon-alice'));
    // Modal должен открыться с заголовком, содержащим AID.
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Отозвать archon-alice/i })).toBeInTheDocument();
    });
    // Внутри Modal вводим reason и submit.
    const textarea = screen.getByPlaceholderText(/уход сотрудника/i);
    await user.type(textarea, 'компрометация ключа');
    await user.click(screen.getByTestId('revoke-submit'));
    await waitFor(() => {
      expect(calls.some((c) => c.url === '/v1/operators/archon-alice/revoke' && c.method === 'POST')).toBe(true);
    });
    // Body содержит reason без поля aid (path-param — авторитет).
    const revokeCall = calls.find((c) => c.url === '/v1/operators/archon-alice/revoke');
    expect(revokeCall?.body).toContain('компрометация ключа');
  });

  it('Revoke 409 (last cluster-admin) — pretty-error в Modal, Modal не закрывается', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.startsWith('/v1/operators') && method === 'GET') {
        return new Response(JSON.stringify(SAMPLE_LIST), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.match(/\/v1\/operators\/.+\/revoke/) && method === 'POST') {
        return new Response(
          JSON.stringify({
            type: 'https://soul-stack.io/errors/last-cluster-admin',
            title: 'Conflict',
            status: 409,
            detail: 'would lock out cluster',
          }),
          {
            status: 409,
            headers: { 'Content-Type': 'application/problem+json' },
          },
        );
      }
      return new Response('{}', { status: 599 });
    }) as typeof fetch;

    renderWithProviders(<ArchonsList />, '/archons');
    await waitFor(() => {
      // Hide revoked default ON → 2 видимых строки (bootstrap, alice).
      expect(screen.getByTestId('revoke-archon-alice')).toBeInTheDocument();
    });
    const user = userEvent.setup();
    await user.click(screen.getByTestId('revoke-archon-alice'));
    await user.click(await screen.findByTestId('revoke-submit'));
    // Pretty-error виден в Modal; Modal не закрывается.
    expect(await screen.findByRole('alert')).toHaveTextContent(/last-?cluster-?admin|self-lockout|последнего/i);
    expect(screen.getByRole('dialog', { name: /Отозвать archon-alice/i })).toBeInTheDocument();
  });

  it('Create — POST /v1/operators возвращает jwt, рендерит JwtReveal', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: { items: [], offset: 0, limit: 50, total: 0 } },
      {
        method: 'POST',
        url: '/v1/operators',
        status: 201,
        body: {
          aid: 'archon-alice',
          display_name: 'Alice',
          created_at: '2026-05-26T10:00:00Z',
          created_by_aid: 'archon-bob',
          jwt: 'eyJ.payload.sig',
        },
      },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('archon-alice'), 'archon-alice');
    await user.type(screen.getByPlaceholderText(/Alice Ops/i), 'Alice');

    const createBtn = screen.getByRole('button', { name: /Создать/i });
    expect(createBtn).not.toBeDisabled();
    await user.click(createBtn);

    await waitFor(() => {
      expect(screen.getByText(/JWT выпущен/i)).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('eyJ.payload.sig')).toBeInTheDocument();
  });

  it('inline-ошибка pattern при некорректном AID', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: { items: [], offset: 0, limit: 50, total: 0 } },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('archon-alice'), 'Alice!');
    expect(screen.getAllByText(/pattern/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Создать/i })).toBeDisabled();
  });

  it('пустой display_name блокирует submit, валидный AID', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: { items: [], offset: 0, limit: 50, total: 0 } },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    // Валидный AID, но display_name пуст → submit disabled.
    await user.type(screen.getByPlaceholderText('archon-alice'), 'archon-alice');
    expect(screen.getByRole('button', { name: /Создать/i })).toBeDisabled();
    // Заполнили display_name → submit разблокирован.
    await user.type(screen.getByPlaceholderText(/Alice Ops/i), 'Alice');
    expect(screen.getByRole('button', { name: /Создать/i })).not.toBeDisabled();
  });

  it('display_name > 128 символов — inline-ошибка + submit disabled', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: { items: [], offset: 0, limit: 50, total: 0 } },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('archon-alice'), 'archon-alice');
    await user.type(screen.getByPlaceholderText(/Alice Ops/i), 'x'.repeat(129));
    expect(screen.getByText(/максимум 128 символов/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Создать/i })).toBeDisabled();
  });

  // --- Multi-select ролей (extended payload {aid, display_name, roles[]}) ---

  const SAMPLE_ROLES = {
    items: [
      { name: 'cluster-admin', description: 'root', builtin: true, permissions: ['*'], operators: [] },
      { name: 'ops-viewer', description: 'read-only', builtin: false, permissions: ['*.read'], operators: [] },
      { name: 'release-engineer', description: 'release', builtin: false, permissions: ['incarnation.*'], operators: [] },
    ],
  };

  it('TestCreateArchon_WithRoles_SendsRolesInPayload', async () => {
    const calls: Array<{ url: string; method: string; body: string | null }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : null;
      calls.push({ url, method, body });
      if (url.startsWith('/v1/operators') && method === 'GET') {
        return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith('/v1/roles') && method === 'GET') {
        return new Response(JSON.stringify(SAMPLE_ROLES), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/v1/operators' && method === 'POST') {
        return new Response(
          JSON.stringify({
            aid: 'archon-alice',
            display_name: 'Alice',
            created_at: '2026-05-27T10:00:00Z',
            created_by_aid: 'archon-bob',
            jwt: 'eyJ.payload.sig',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 599 });
    }) as typeof fetch;

    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('archon-alice'), 'archon-alice');
    await user.type(screen.getByPlaceholderText(/Alice Ops/i), 'Alice');

    // Ждём, пока select наполнится опциями.
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /добавить роль/i })).not.toBeDisabled();
    });
    const rolesSelect = screen.getByRole('combobox', { name: /добавить роль/i });
    await user.selectOptions(rolesSelect, 'ops-viewer');
    await user.selectOptions(rolesSelect, 'release-engineer');

    // Chips появились.
    expect(screen.getByText('ops-viewer')).toBeInTheDocument();
    expect(screen.getByText('release-engineer')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Создать/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/operators' && c.method === 'POST');
      expect(post).toBeDefined();
      const parsed = JSON.parse(post!.body ?? '{}') as { roles?: string[] };
      expect(parsed.roles).toEqual(['ops-viewer', 'release-engineer']);
    });
  });

  it('TestCreateArchon_NoRoles_OK', async () => {
    const calls: Array<{ url: string; method: string; body: string | null }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : null;
      calls.push({ url, method, body });
      if (url.startsWith('/v1/operators') && method === 'GET') {
        return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith('/v1/roles') && method === 'GET') {
        return new Response(JSON.stringify(SAMPLE_ROLES), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/v1/operators' && method === 'POST') {
        return new Response(
          JSON.stringify({
            aid: 'archon-alice',
            display_name: 'Alice',
            created_at: '2026-05-27T10:00:00Z',
            created_by_aid: 'archon-bob',
            jwt: 'eyJ.payload.sig',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 599 });
    }) as typeof fetch;

    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('archon-alice'), 'archon-alice');
    await user.type(screen.getByPlaceholderText(/Alice Ops/i), 'Alice');
    await user.click(screen.getByRole('button', { name: /Создать/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/operators' && c.method === 'POST');
      expect(post).toBeDefined();
      const parsed = JSON.parse(post!.body ?? '{}') as { roles?: string[] };
      // Без выбора — поле либо отсутствует, либо пустой массив (мы не отправляем roles, если пусто).
      expect(parsed.roles === undefined || parsed.roles.length === 0).toBe(true);
    });
  });

  it('TestCreateArchon_UnknownRole_422', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.startsWith('/v1/operators') && method === 'GET') {
        return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith('/v1/roles') && method === 'GET') {
        return new Response(JSON.stringify(SAMPLE_ROLES), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/v1/operators' && method === 'POST') {
        return new Response(
          JSON.stringify({
            type: 'https://soul-stack.io/errors/validation-failed',
            title: 'Unprocessable Entity',
            status: 422,
            detail: 'unknown role: ops-viewer',
          }),
          { status: 422, headers: { 'Content-Type': 'application/problem+json' } },
        );
      }
      return new Response('{}', { status: 599 });
    }) as typeof fetch;

    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('archon-alice'), 'archon-alice');
    await user.type(screen.getByPlaceholderText(/Alice Ops/i), 'Alice');
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /добавить роль/i })).not.toBeDisabled();
    });
    await user.selectOptions(screen.getByRole('combobox', { name: /добавить роль/i }), 'ops-viewer');
    await user.click(screen.getByRole('button', { name: /Создать/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/422/);
    expect(alert).toHaveTextContent(/unknown role|validation/i);
  });

  it('Backend без поддержки roles (404 на extended payload) — graceful degradation', async () => {
    let postCount = 0;
    const postBodies: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : null;
      if (url.startsWith('/v1/operators') && method === 'GET') {
        return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith('/v1/roles') && method === 'GET') {
        return new Response(JSON.stringify(SAMPLE_ROLES), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/v1/operators' && method === 'POST') {
        postCount += 1;
        postBodies.push(body ?? '');
        // Первый POST — с roles[] — backend ещё не поддерживает: 404.
        if (postCount === 1) {
          return new Response(
            JSON.stringify({
              type: 'https://soul-stack.io/errors/not-found',
              title: 'Not Found',
              status: 404,
              detail: 'roles[] field not supported',
            }),
            { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
          );
        }
        // Второй POST — fallback без roles[] — 201.
        return new Response(
          JSON.stringify({
            aid: 'archon-alice',
            display_name: 'Alice',
            created_at: '2026-05-27T10:00:00Z',
            created_by_aid: 'archon-bob',
            jwt: 'eyJ.payload.sig',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 599 });
    }) as typeof fetch;

    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('archon-alice'), 'archon-alice');
    await user.type(screen.getByPlaceholderText(/Alice Ops/i), 'Alice');
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /добавить роль/i })).not.toBeDisabled();
    });
    await user.selectOptions(screen.getByRole('combobox', { name: /добавить роль/i }), 'ops-viewer');
    await user.click(screen.getByRole('button', { name: /Создать/i }));

    // JWT отрисован — Архонт всё-таки создан.
    await waitFor(() => {
      expect(screen.getByText(/JWT выпущен/i)).toBeInTheDocument();
    });
    // Было два POST: с roles и без.
    expect(postCount).toBe(2);
    expect(JSON.parse(postBodies[0])).toHaveProperty('roles');
    expect(JSON.parse(postBodies[1]).roles).toBeUndefined();
    // Подсказка пользователю про unsupported.
    expect(screen.getByRole('status')).toHaveTextContent(/backend не поддерживает/i);
  });
});
