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

  it('фильтры auth_method + include-revoked попадают в query', async () => {
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
    await user.click(screen.getByLabelText(/Включая revoked/i));
    await waitFor(() => {
      expect(lastUrl).toMatch(/auth_method=jwt/);
      expect(lastUrl).toMatch(/revoked=true/);
    });
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
      expect(screen.getAllByRole('button', { name: /^Revoke$/ }).length).toBe(3);
    });
    const user = userEvent.setup();
    const revokeButtons = screen.getAllByRole('button', { name: /^Revoke$/ });
    // archon-old (3-я строка) — disabled (revoked); кликаем по archon-alice (idx=1).
    await user.click(revokeButtons[1]);
    // Modal должен открыться с заголовком, содержащим AID.
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Отозвать archon-alice/i })).toBeInTheDocument();
    });
    // Внутри Modal вводим reason и submit.
    const textarea = screen.getByPlaceholderText(/уход сотрудника/i);
    await user.type(textarea, 'компрометация ключа');
    await user.click(screen.getByRole('button', { name: /^Отозвать$/ }));
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
      expect(screen.getAllByRole('button', { name: /^Revoke$/ }).length).toBe(3);
    });
    const user = userEvent.setup();
    const revokeButtons = screen.getAllByRole('button', { name: /^Revoke$/ });
    await user.click(revokeButtons[1]);
    await user.click(await screen.findByRole('button', { name: /^Отозвать$/ }));
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
});
