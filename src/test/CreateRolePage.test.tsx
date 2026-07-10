import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { CreateRolePage } from '../pages/rbac/CreateRolePage';
import { tokenStore } from '../api/tokenStore';

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
    {
      resource: 'soul',
      actions: [
        { action: 'list', selector_keys: ['coven', 'sid'] },
        { action: 'read', selector_keys: ['coven', 'sid'] },
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

function recordingFetch(opts?: {
  conflict?: { path: RegExp; method: string; status: number; type?: string; detail?: string };
}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : null;
    calls.push({ url, method, body });

    if (opts?.conflict && opts.conflict.path.test(url) && method === opts.conflict.method) {
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
      return new Response(JSON.stringify(PERMISSIONS_SAMPLE), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('/v1/incarnations') && method === 'GET') {
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 200, total: 0 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('/v1/services') && method === 'GET') {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('/v1/souls') && method === 'GET') {
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 500, total: 0 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === '/v1/roles' && method === 'POST') return new Response('', { status: 201 });
    return new Response('{}', { status: 599 });
  });
  return calls;
}

// Роутинг: страница на /rbac/roles/new, маркер на /rbac для проверки навигации.
function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/rbac" element={<div>RBAC-LANDING</div>} />
      <Route path="/rbac/roles/new" element={<CreateRolePage />} />
    </Routes>,
    '/rbac/roles/new',
  );
}

describe('CreateRolePage (NIM-80)', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит форму и каталог permissions сгруппированно', async () => {
    recordingFetch();
    renderPage();
    expect(screen.getByRole('heading', { name: /Создать роль/i })).toBeInTheDocument();
    expect(await screen.findByRole('checkbox', { name: 'audit.read' })).toBeInTheDocument();
    // Wildcard-строки на группу.
    expect(screen.getByRole('checkbox', { name: /incarnation\.\*/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /soul\.\*/ })).toBeInTheDocument();
  });

  it('name + wildcard incarnation.* → POST с ["incarnation.*"] и переход на /rbac', async () => {
    const calls = recordingFetch();
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('soul-operator'), 'inc-admin');
    const wildcard = await screen.findByRole('checkbox', { name: /incarnation\.\*/ });
    await user.click(wildcard);
    await user.click(screen.getByRole('button', { name: /^Создать$/ }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/roles' && c.method === 'POST');
      expect(post).toBeDefined();
      expect(post!.body).toContain('"name":"inc-admin"');
      expect(post!.body).toContain('"incarnation.*"');
      // Не перечисление действий.
      expect(post!.body).not.toContain('incarnation.read');
    });
    // Успех → навигация на /rbac.
    await waitFor(() => expect(screen.getByText('RBAC-LANDING')).toBeInTheDocument());
  });

  it('scope на странице: soul.list + coven=ops → POST "soul.list on coven=ops"', async () => {
    const calls = recordingFetch();
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('soul-operator'), 'soul-ops');
    const cb = await screen.findByRole('checkbox', { name: 'soul.list' });
    await user.click(cb);
    const keySelect = await screen.findByRole('combobox', { name: /^ключ селектора scope$/i });
    await user.selectOptions(keySelect, 'coven');
    const valueInput = await screen.findByRole('textbox', { name: /значение coven$/i });
    await user.type(valueInput, 'ops');
    await user.click(screen.getByRole('button', { name: /^Создать$/ }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/roles' && c.method === 'POST');
      expect(post).toBeDefined();
      expect(post!.body).toContain('soul.list on coven=ops');
    });
  });

  it('409 already-exists → ошибка видна, страница не покидается', async () => {
    recordingFetch({
      conflict: {
        path: /^\/v1\/roles$/,
        method: 'POST',
        status: 409,
        type: 'https://soul-stack.io/errors/role-already-exists',
        detail: 'role log-reader already exists',
      },
    });
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('soul-operator'), 'log-reader');
    await user.click(screen.getByRole('button', { name: /^Создать$/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/уже существует|already exists/i);
    // Остаёмся на странице (маркер /rbac не появился).
    expect(screen.queryByText('RBAC-LANDING')).not.toBeInTheDocument();
  });

  it('невалидное имя (не kebab-case) → клиентская валидация, POST не уходит', async () => {
    const calls = recordingFetch();
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('soul-operator'), 'Bad Name');
    await user.click(screen.getByRole('button', { name: /^Создать$/ }));

    // Zod-валидация блокирует submit — POST не должен уйти.
    await waitFor(() => {
      expect(screen.getByText(/kebab-case/i)).toBeInTheDocument();
    });
    expect(calls.find((c) => c.url === '/v1/roles' && c.method === 'POST')).toBeUndefined();
  });

  it('#3: невалидный scope (пробел в значении) → ошибка прав видна, POST не уходит', async () => {
    const calls = recordingFetch();
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('soul-operator'), 'scoped-role');
    const cb = await screen.findByRole('checkbox', { name: 'soul.list' });
    await user.click(cb);
    const keySelect = await screen.findByRole('combobox', { name: /^ключ селектора scope$/i });
    await user.selectOptions(keySelect, 'coven');
    const valueInput = await screen.findByRole('textbox', { name: /значение coven$/i });
    await user.type(valueInput, 'ops team'); // пробел → 'soul.list on coven=ops team' не проходит regex
    await user.click(screen.getByRole('button', { name: /^Создать$/ }));

    // Клиентская валидация ловит битую permission-строку — виден alert, POST не уходит.
    expect(await screen.findByText(/недопустим|invalid/i)).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/v1/roles' && c.method === 'POST')).toBeUndefined();
  });

  it('Cancel → возврат на /rbac без POST', async () => {
    const calls = recordingFetch();
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Отмена|Cancel/i }));
    await waitFor(() => expect(screen.getByText('RBAC-LANDING')).toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST')).toBeUndefined();
  });
});
