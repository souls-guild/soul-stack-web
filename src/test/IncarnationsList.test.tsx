import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { IncarnationsList } from '../pages/incarnations/IncarnationsList';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

describe('IncarnationsList', () => {
  beforeEach(() => {
    tokenStore.clear();
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
      // Link to incarnation - the only role=link with this name (name same as coven-tag -> badge is not a link).
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
    // Roll back to initial call with empty coven.
    await waitFor(() => expect(called).toBeGreaterThanOrEqual(1));
    const initial = called;
    await user.type(covenInput, 'Prod-Bad!');
    expect(await screen.findByText(/Не валидная coven-метка/i)).toBeInTheDocument();
    // No re-request with an invalid value was made.
    expect(called).toBe(initial);
  });

  // -- Guard tests: clickable links --------------------------------------

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

    // Service names are links to /services/:name.
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

    // Version is plain text, not a link.
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

    // No links to /services/*.
    expect(screen.queryByRole('link', { name: /redis|postgres/i })).not.toBeInTheDocument();
  });

  it('колонка Traits рендерит chips и graceful "—" при отсутствии traits', async () => {
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
              traits: { team: 'platform' },
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

    await waitFor(() => expect(screen.getByRole('link', { name: 'redis-prod' })).toBeInTheDocument());

    // Inside the table: one chip cell + one chip option of the multiselect - both
    // are textually equal to 'team=platform', so we check within the table scope.
    const table = screen.getByRole('table');
    expect(within(table).getByText('team=platform')).toBeInTheDocument();
    // postgres-stage without traits - there is at least one em-dash fallback (page does not crash).
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('мультиселект coven+traits фильтрует client-side по AND', async () => {
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
              traits: { team: 'platform' },
              status: 'ready',
              created_by_aid: 'archon-alice',
              created_at: '2026-05-25T10:00:00Z',
              updated_at: '2026-05-25T12:00:00Z',
            },
            {
              name: 'redis-stage',
              service: 'redis',
              service_version: 'v2.0.0',
              state_schema_version: 3,
              covens: ['stage'],
              traits: { team: 'platform' },
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
              traits: { team: 'data' },
              status: 'drift',
              created_by_aid: 'archon-bob',
              created_at: '2026-05-20T10:00:00Z',
              updated_at: '2026-05-25T11:30:00Z',
            },
          ],
          offset: 0,
          limit: 100,
          total: 3,
        },
      },
    ]);

    renderWithProviders(<IncarnationsList />, '/incarnations');

    await waitFor(() => expect(screen.getByRole('link', { name: 'redis-prod' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'redis-stage' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'postgres-stage' })).toBeInTheDocument();

    const user = userEvent.setup();

    // Select coven=stage (multiselect) - leaves redis-stage + postgres-stage.
    await user.click(screen.getByRole('button', { name: 'stage' }));
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'redis-prod' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'redis-stage' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'postgres-stage' })).toBeInTheDocument();

    // + trait team=platform (AND) - leaves only redis-stage.
    await user.click(screen.getByRole('button', { name: 'team=platform' }));
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'postgres-stage' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'redis-stage' })).toBeInTheDocument();

    // Reset filter - returns all three.
    await user.click(screen.getByText('Сбросить фильтр'));
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'redis-prod' })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'postgres-stage' })).toBeInTheDocument();
  });
});
