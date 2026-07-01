import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from './renderWithProviders';
import { OverviewPage } from '../pages/overview/OverviewPage';

// Хелпер: строит mock-fetch который диспатчит по URL+params.
// Используем vi.stubGlobal напрямую (installFetchMock не поддерживает
// два одинаковых URL с разными ответами).
function mockFetch(handlers: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    // Матчим по первому вхождению ключа, который является префиксом URL.
    for (const [key, body] of Object.entries(handlers)) {
      if (urlStr.startsWith(key)) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ title: 'not mocked', url: urlStr }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
}

const VOYAGE_ITEM = {
  voyage_id: 'abcdef1234567890abc',
  kind: 'scenario',
  status: 'succeeded',
  started_at: new Date(Date.now() - 60_000).toISOString(),
  scope_size: 3,
  attempt: 1,
  current_batch_index: 0,
  total_batches: 1,
  dry_run: false,
  created_at: new Date().toISOString(),
  started_by_aid: 'archon-ops',
  target: { incarnations: ['redis-prod'] },
  scenario_name: 'update',
};

describe('OverviewPage', () => {
  it('рендерит счётчики souls/services/incarnations и последние прогоны', async () => {
    // Используем разные query-параметры чтобы отличить запросы:
    // souls?limit=1 (all) vs souls?status=connected&limit=1
    // incarnations?limit=1 (all) vs incarnations?status=applying&limit=1
    // voyages?limit=1 (active) vs voyages?limit=5 (recent)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (urlStr.startsWith('/v1/souls') && urlStr.includes('status=connected')) {
        return new Response(JSON.stringify({ items: [], total: 3, next_cursor: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.startsWith('/v1/souls')) {
        return new Response(JSON.stringify({ items: [], total: 5, next_cursor: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.startsWith('/v1/services')) {
        return new Response(JSON.stringify({ items: [{ name: 'redis', git: 'g', ref: 'main' }, { name: 'pg', git: 'g', ref: 'main' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.startsWith('/v1/incarnations') && urlStr.includes('status=applying')) {
        return new Response(JSON.stringify({ items: [], total: 2, offset: 0, limit: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.startsWith('/v1/incarnations')) {
        return new Response(JSON.stringify({ items: [], total: 7, offset: 0, limit: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.startsWith('/v1/voyages') && urlStr.includes('limit=5')) {
        return new Response(JSON.stringify({ items: [VOYAGE_ITEM], total: 1, offset: 0, limit: 5 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.startsWith('/v1/voyages')) {
        return new Response(JSON.stringify({ items: null, total: 1, offset: 0, limit: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    }));

    renderWithProviders(<OverviewPage />, '/overview');

    // Счётчики souls: connected=3, total=5
    await waitFor(() => {
      expect(screen.getByText('3 / 5')).toBeInTheDocument();
    });
    // Services: 2
    expect(screen.getByText('2')).toBeInTheDocument();
    // Incarnations: 7
    expect(screen.getByText('7')).toBeInTheDocument();

    // Последние прогоны: kind=scenario, target=redis-prod, status=succeeded
    await waitFor(() => {
      expect(screen.getByText('scenario')).toBeInTheDocument();
    });
    expect(screen.getByText('redis-prod')).toBeInTheDocument();
    expect(screen.getByText('succeeded')).toBeInTheDocument();
  });

  it('graceful empty — нет прогонов → empty-state', async () => {
    mockFetch({
      '/v1/souls': { items: [], total: 0, next_cursor: null },
      '/v1/services': { items: [] },
      '/v1/incarnations': { items: [], total: 0, offset: 0, limit: 1 },
      '/v1/voyages': { items: null, total: 0, offset: 0, limit: 5 },
    });
    renderWithProviders(<OverviewPage />, '/overview');
    await waitFor(() => {
      expect(screen.getByText('0 / 0')).toBeInTheDocument();
    });
    expect(await screen.findByText(/Прогонов пока не было/i)).toBeInTheDocument();
  });
});
