import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { IncarnationsList } from '../pages/incarnations/IncarnationsList';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

describe('IncarnationsList', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('рендерит заголовок и список из /v1/incarnations', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations',
        body: {
          items: [
            {
              name: 'redis-prod',
              service: 'redis',
              service_version: 'v2.0.0',
              state_schema_version: 3,
              covens: ['prod', 'redis-prod'],
              status: 'ready',
              created_by_aid: 'archon-alice',
              created_at: '2026-05-25T10:00:00Z',
              updated_at: '2026-05-25T12:00:00Z',
            },
            {
              name: 'postgres-stage',
              service: 'postgres',
              service_version: 'main',
              state_schema_version: 1,
              covens: ['stage'],
              status: 'drift',
              created_by_aid: 'archon-bob',
              created_at: '2026-05-20T10:00:00Z',
              updated_at: '2026-05-25T11:30:00Z',
            },
          ],
          offset: 0,
          limit: 100,
          total: 2,
        },
      },
    ]);

    renderWithProviders(<IncarnationsList />, '/incarnations');

    expect(screen.getByRole('heading', { name: /Incarnations/i })).toBeInTheDocument();
    await waitFor(() => {
      // Link на incarnation — единственный role=link с этим именем (имя same as coven-tag → badge не link).
      expect(screen.getByRole('link', { name: 'redis-prod' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'postgres-stage' })).toBeInTheDocument();
    });
  });

  it('показывает empty-state при пустом списке', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations',
        body: { items: [], offset: 0, limit: 100, total: 0 },
      },
    ]);
    renderWithProviders(<IncarnationsList />, '/incarnations');
    await waitFor(() => {
      expect(screen.getByText(/не найдено/i)).toBeInTheDocument();
    });
  });

  it('передаёт server-side coven=<x> в запрос /v1/incarnations', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(urlStr);
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 100, total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(<IncarnationsList />, '/incarnations');

    const user = userEvent.setup();
    const covenInput = await screen.findByPlaceholderText(/prod \/ staging/i);
    await user.type(covenInput, 'prod');

    await waitFor(() => {
      expect(calls.some((u) => u.includes('coven=prod'))).toBe(true);
    });
  });

  it('inline-error на невалидной coven-метке (не отправляет запрос)', async () => {
    let called = 0;
    vi.stubGlobal('fetch', async () => {
      called += 1;
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 100, total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(<IncarnationsList />, '/incarnations');

    const user = userEvent.setup();
    const covenInput = await screen.findByPlaceholderText(/prod \/ staging/i);
    // Поднимаемся до initial call с пустым coven.
    await waitFor(() => expect(called).toBeGreaterThanOrEqual(1));
    const initial = called;
    await user.type(covenInput, 'Prod-Bad!');
    expect(await screen.findByText(/Не валидная coven-метка/i)).toBeInTheDocument();
    // Перезапроса с невалидным значением не было.
    expect(called).toBe(initial);
  });

  // ── Guard-тесты: кликабельные ссылки ──────────────────────────────────────

  it('[LINKS] имя сервиса рендерится ссылкой на /services/:name', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations',
        body: {
          items: [
            {
              name: 'redis-prod',
              service: 'redis',
              service_version: 'v2.0.0',
              state_schema_version: 3,
              covens: ['prod'],
              status: 'ready',
              created_by_aid: 'archon-alice',
              created_at: '2026-05-25T10:00:00Z',
              updated_at: '2026-05-25T12:00:00Z',
              last_drift_check_at: null,
            },
            {
              name: 'postgres-stage',
              service: 'postgres',
              service_version: 'main',
              state_schema_version: 1,
              covens: ['stage'],
              status: 'drift',
              created_by_aid: 'archon-bob',
              created_at: '2026-05-20T10:00:00Z',
              updated_at: '2026-05-25T11:30:00Z',
              last_drift_check_at: null,
            },
          ],
          offset: 0,
          limit: 100,
          total: 2,
        },
      },
    ]);
    renderWithProviders(<IncarnationsList />, '/incarnations');

    await waitFor(() => expect(screen.getByRole('link', { name: 'redis-prod' })).toBeInTheDocument());

    // Имена сервисов — ссылки на /services/:name.
    const redisLink = screen.getByRole('link', { name: 'redis' });
    expect(redisLink).toHaveAttribute('href', '/services/redis');

    const postgresLink = screen.getByRole('link', { name: 'postgres' });
    expect(postgresLink).toHaveAttribute('href', '/services/postgres');
  });

  it('[LINKS] version-суффикс (@v2.0.0) остаётся текстом, не ссылкой', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations',
        body: {
          items: [
            {
              name: 'redis-prod',
              service: 'redis',
              service_version: 'v2.0.0',
              state_schema_version: 3,
              covens: ['prod'],
              status: 'ready',
              created_by_aid: 'archon-alice',
              created_at: '2026-05-25T10:00:00Z',
              updated_at: '2026-05-25T12:00:00Z',
              last_drift_check_at: null,
            },
          ],
          offset: 0,
          limit: 100,
          total: 1,
        },
      },
    ]);
    renderWithProviders(<IncarnationsList />, '/incarnations');

    await waitFor(() => expect(screen.getByRole('link', { name: 'redis-prod' })).toBeInTheDocument());

    // Версия — просто текст, не ссылка.
    expect(screen.getByText('@v2.0.0')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /@v2\.0\.0/ })).not.toBeInTheDocument();
  });

  it('[LINKS] пустой список — нет ссылок на сервисы', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations',
        body: { items: [], offset: 0, limit: 100, total: 0 },
      },
    ]);
    renderWithProviders(<IncarnationsList />, '/incarnations');

    await waitFor(() => expect(screen.getByText(/не найдено/i)).toBeInTheDocument());

    // Нет ссылок на /services/*.
    expect(screen.queryByRole('link', { name: /redis|postgres/i })).not.toBeInTheDocument();
  });
});
