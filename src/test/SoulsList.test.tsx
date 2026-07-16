import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

function RunLandingStub() {
  const loc = useLocation();
  return (
    <div data-testid="run-landing">
      <span data-testid="run-search">{loc.search}</span>
    </div>
  );
}
import { renderWithProviders } from './renderWithProviders';
import { SoulsList } from '../pages/souls/SoulsList';
import {
  applyFilter,
  evalRule,
  parseSoulprintFilter,
} from '../pages/souls/soulprintFilter';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

// Helper with routes for bulk-run tests: SoulsList + landing-stub /run.
function renderSoulsListWithRun() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrap({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/souls']}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(
    <Routes>
      <Route path="/souls" element={<SoulsList />} />
      <Route path="/run" element={<RunLandingStub />} />
    </Routes>,
    { wrapper: Wrap },
  );
}

describe('SoulsList', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  it('рендерит список Souls из /v1/souls', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/souls',
        body: {
          items: [
            {
              sid: 'host01.example.com',
              transport: 'agent',
              status: 'connected',
              covens: ['prod', 'redis-prod'],
              last_seen_at: new Date(Date.now() - 30_000).toISOString(),
              last_seen_by_kid: 'keeper-01',
              registered_at: '2026-05-01T00:00:00Z',
            },
          ],
          offset: 0,
          limit: 200,
          total: 1,
        },
      },
    ]);
    renderWithProviders(<SoulsList />, '/souls');
    expect(screen.getByRole('heading', { name: /Souls/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('host01.example.com')).toBeInTheDocument();
    });
    // 'connected' appears both in the <option> of the select-filter and in the Badge —
    // so we match all occurrences and make sure the Badge rendered.
    expect(screen.getAllByText('connected').length).toBeGreaterThanOrEqual(2);
  });

  it('Bulk Run on selected: navigate /run?target_sids=<csv>', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/souls',
        body: {
          items: [
            {
              sid: 'host01.example.com',
              transport: 'agent',
              status: 'connected',
              covens: ['prod'],
              registered_at: '2026-05-01T00:00:00Z',
            },
            {
              sid: 'host02.example.com',
              transport: 'agent',
              status: 'connected',
              covens: ['prod'],
              registered_at: '2026-05-01T00:00:00Z',
            },
          ],
          offset: 0,
          limit: 200,
          total: 2,
        },
      },
    ]);
    const user = userEvent.setup();
    renderSoulsListWithRun();

    await waitFor(() => {
      expect(screen.getByText('host01.example.com')).toBeInTheDocument();
      expect(screen.getByText('host02.example.com')).toBeInTheDocument();
    });

    // Bulk Run button must be disabled until selection.
    const runBtn = screen.getByRole('button', { name: /Bulk Run on selected/ });
    expect(runBtn).toBeDisabled();

    // Select both hosts via row-checkbox.
    await user.click(screen.getByLabelText('выбрать host01.example.com'));
    await user.click(screen.getByLabelText('выбрать host02.example.com'));

    // Counter in the button.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Bulk Run on selected/ })).not.toBeDisabled(),
    );

    await user.click(screen.getByRole('button', { name: /Bulk Run on selected/ }));

    await waitFor(() => {
      expect(screen.getByTestId('run-landing')).toBeInTheDocument();
    });
    const search = screen.getByTestId('run-search').textContent ?? '';
    expect(search).toContain('workload=command');
    expect(search).toContain('target_sids=');
    // CSV allows both `host01,host02` and a URL-encoded comma.
    expect(decodeURIComponent(search)).toMatch(/target_sids=host0[12]\.example\.com,host0[12]\.example\.com/);
  });

  it('soulprint-filter: lazy fetch + client-side фильтрация по фактам', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/souls/host-debian.local/soulprint',
        body: {
          sid: 'host-debian.local',
          typed_facts: {
            sid: 'host-debian.local',
            hostname: 'host-debian',
            os: { family: 'debian', distro: 'ubuntu', version: '22.04', pkg_mgr: 'apt' },
            memory: { total_mb: 8192 },
          },
        },
      },
      {
        method: 'GET',
        url: '/v1/souls/host-alpine.local/soulprint',
        body: {
          sid: 'host-alpine.local',
          typed_facts: {
            sid: 'host-alpine.local',
            hostname: 'host-alpine',
            os: { family: 'alpine', distro: 'alpine', version: '3.19', pkg_mgr: 'apk' },
            memory: { total_mb: 2048 },
          },
        },
      },
      {
        method: 'GET',
        url: '/v1/souls',
        body: {
          items: [
            {
              sid: 'host-debian.local',
              transport: 'agent',
              status: 'connected',
              covens: ['prod'],
              registered_at: '2026-05-01T00:00:00Z',
            },
            {
              sid: 'host-alpine.local',
              transport: 'agent',
              status: 'connected',
              covens: ['prod'],
              registered_at: '2026-05-01T00:00:00Z',
            },
          ],
          offset: 0,
          limit: 200,
          total: 2,
        },
      },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<SoulsList />, '/souls');
    await waitFor(() => {
      expect(screen.getByText('host-debian.local')).toBeInTheDocument();
      expect(screen.getByText('host-alpine.local')).toBeInTheDocument();
    });

    const input = screen.getByLabelText('search soulprint');
    await user.type(input, 'os.family=debian');

    await waitFor(() => {
      expect(screen.queryByText('host-alpine.local')).not.toBeInTheDocument();
    });
    expect(screen.getByText('host-debian.local')).toBeInTheDocument();
    expect(screen.getByText(/Matched 1 of 2/)).toBeInTheDocument();
  });
});

describe('SoulsList — keyset pagination', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  // Guard: when next_cursor is present in the response — "Load more" button renders;
  // on click — the next request carries cursor= in the URL.
  it('показывает кнопку «Загрузить ещё» при наличии next_cursor, передаёт cursor в следующий запрос', async () => {
    const page1Items = [
      { sid: 'host01.example.com', transport: 'agent' as const, status: 'connected' as const, registered_at: '2026-05-01T00:00:00Z' },
      { sid: 'host02.example.com', transport: 'agent' as const, status: 'connected' as const, registered_at: '2026-05-01T00:00:00Z' },
    ];
    const page2Items = [
      { sid: 'host03.example.com', transport: 'agent' as const, status: 'connected' as const, registered_at: '2026-05-01T00:00:00Z' },
    ];

    // fetchMock: first request without cursor= -> page1; with cursor=tok1 -> page2.
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url.includes('cursor=tok1')) {
        return new Response(JSON.stringify({
          items: page2Items,
          offset: 0,
          limit: 100,
          total: 0,
          total_approximate: true,
          // next_cursor absent -> last page
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        items: page1Items,
        offset: 0,
        limit: 100,
        total: 5,
        total_approximate: true,
        next_cursor: 'tok1',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const user = userEvent.setup();
    renderWithProviders(<SoulsList />, '/souls');

    // Wait for the first page.
    await waitFor(() => {
      expect(screen.getByText('host01.example.com')).toBeInTheDocument();
      expect(screen.getByText('host02.example.com')).toBeInTheDocument();
    });

    // "Load more" button must be visible (next_cursor present).
    const btn = screen.getByTestId('load-more-btn');
    expect(btn).toBeInTheDocument();

    // Click "Load more".
    await user.click(btn);

    // Second request must contain cursor=tok1 in the URL.
    await waitFor(() => {
      expect(screen.getByText('host03.example.com')).toBeInTheDocument();
    });

    // First page must also be present (accumulation).
    expect(screen.getByText('host01.example.com')).toBeInTheDocument();
    expect(screen.getByText('host02.example.com')).toBeInTheDocument();

    // "Load more" button is gone (next_cursor disappeared).
    expect(screen.queryByTestId('load-more-btn')).not.toBeInTheDocument();

    // Check that the second fetch call contained cursor= in the URL.
    const calls = fetchSpy.mock.calls;
    const cursorCall = calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      return url.includes('cursor=tok1');
    });
    expect(cursorCall).toBeDefined();
  });

  // Guard: total_approximate=true -> renders an element with an approximate marker.
  it('total_approximate=true → показывает приблизительный маркер счётчика', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/souls',
        body: {
          items: [
            { sid: 'host01.example.com', transport: 'agent', status: 'connected', registered_at: '2026-05-01T00:00:00Z' },
          ],
          offset: 0,
          limit: 100,
          total: 50,
          total_approximate: true,
          next_cursor: 'tok1',
        },
      },
    ]);
    renderWithProviders(<SoulsList />, '/souls');

    await waitFor(() => {
      expect(screen.getByText('host01.example.com')).toBeInTheDocument();
    });

    // The element with the approximate counter must be in the DOM.
    const countEl = screen.getByTestId('count-approximate');
    expect(countEl).toBeInTheDocument();
    // Must contain the ≈ marker.
    expect(countEl.textContent).toContain('≈');
  });

  // Guard: total_approximate=false (offset mode, no next_cursor) -> no "more" button,
  // no approximation marker (regression of coven mode).
  it('offset-режим (нет next_cursor, total_approximate=false) → нет кнопки «ещё» и нет ≈', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/souls',
        body: {
          items: [
            { sid: 'host01.example.com', transport: 'agent', status: 'connected', registered_at: '2026-05-01T00:00:00Z' },
          ],
          offset: 0,
          limit: 100,
          total: 1,
          // total_approximate absent (false by default), next_cursor absent.
        },
      },
    ]);
    renderWithProviders(<SoulsList />, '/souls');

    await waitFor(() => {
      expect(screen.getByText('host01.example.com')).toBeInTheDocument();
    });

    // "Load more" button must not be present.
    expect(screen.queryByTestId('load-more-btn')).not.toBeInTheDocument();
    // Approximation marker must not be present.
    expect(screen.queryByTestId('count-approximate')).not.toBeInTheDocument();
  });

  // Guard: race-condition — changing the filter during an in-flight loadMore.
  // Without the fix: the in-flight response of filter A got mixed into filter B's set.
  // With the fix: the in-flight result is discarded, filter B's set stays clean.
  it('loadMore in-flight: смена фильтра отбрасывает старый ответ, набор нового фильтра чист', async () => {
    // Deferred promise for the second request of filter A (page 2).
    // Resolved manually AFTER the filter change.
    let resolveLoadMoreA!: (r: Response) => void;
    const loadMoreAPromise = new Promise<Response>((res) => { resolveLoadMoreA = res; });

    const filterAPage1Items = [
      { sid: 'filter-a-host01.example.com', transport: 'agent' as const, status: 'connected' as const, registered_at: '2026-05-01T00:00:00Z' },
    ];
    const filterAPage2Items = [
      { sid: 'filter-a-host02.example.com', transport: 'agent' as const, status: 'connected' as const, registered_at: '2026-05-01T00:00:00Z' },
    ];
    const filterBPage1Items = [
      { sid: 'filter-b-host01.example.com', transport: 'agent' as const, status: 'disconnected' as const, registered_at: '2026-05-01T00:00:00Z' },
    ];

    let callCount = 0;
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      callCount++;
      // Request 1: filter A, page 1 (no cursor, no status param -> filterA).
      if (callCount === 1) {
        return new Response(JSON.stringify({
          items: filterAPage1Items,
          offset: 0, limit: 100, total: 2, total_approximate: true,
          next_cursor: 'cursor-a1',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      // Request 2: loadMore of filter A (cursor=cursor-a1) — delayed.
      if (url.includes('cursor=cursor-a1')) {
        return loadMoreAPromise;
      }
      // Request 3: filter B, page 1 (status=disconnected).
      if (url.includes('status=disconnected')) {
        return new Response(JSON.stringify({
          items: filterBPage1Items,
          offset: 0, limit: 100, total: 1, total_approximate: false,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      // fallback
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 100, total: 0 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const user = userEvent.setup();
    renderWithProviders(<SoulsList />, '/souls');

    // Wait for the first page of filter A.
    await waitFor(() => {
      expect(screen.getByText('filter-a-host01.example.com')).toBeInTheDocument();
    });

    // Click "Load more" — the second request (cursor-a1) goes out and hangs.
    const btn = screen.getByTestId('load-more-btn');
    await user.click(btn);

    // Change the filter to "disconnected" — useQuery fires request 3,
    // the accumulator resets to filterB, cursor is cleared.
    const statusSelect = screen.getByRole('combobox', { name: /Status/i });
    await user.selectOptions(statusSelect, 'disconnected');

    // Wait for filter B to render.
    await waitFor(() => {
      expect(screen.getByText('filter-b-host01.example.com')).toBeInTheDocument();
    });

    // Now resolve the delayed response of filter A — with the fix it must be discarded.
    resolveLoadMoreA(new Response(JSON.stringify({
      items: filterAPage2Items,
      offset: 0, limit: 100, total: 0, total_approximate: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    // Give React time to process.
    await waitFor(() => {
      // filter-b-host01 must be present.
      expect(screen.getByText('filter-b-host01.example.com')).toBeInTheDocument();
    });

    // Critical assertions: filter A elements must NOT be present.
    expect(screen.queryByText('filter-a-host01.example.com')).not.toBeInTheDocument();
    expect(screen.queryByText('filter-a-host02.example.com')).not.toBeInTheDocument();

    // No "Load more" button — filter B has no next_cursor.
    expect(screen.queryByTestId('load-more-btn')).not.toBeInTheDocument();
  });

  // Guard: dedup by sid on OVERLAPPING pages.
  // Page A: host-a, host-b (next_cursor=tok). Page B (cursor=tok): host-b (duplicate!), host-c.
  // Invariant: host-b renders EXACTLY once; total rows = 3, not 4.
  it('дедуп: перекрывающиеся страницы — дубль sid рендерится ровно один раз', async () => {
    const page1Items = [
      { sid: 'host-a.example.com', transport: 'agent' as const, status: 'connected' as const, registered_at: '2026-05-01T00:00:00Z' },
      { sid: 'host-b.example.com', transport: 'agent' as const, status: 'connected' as const, registered_at: '2026-05-01T00:00:00Z' },
    ];
    // Page 2 intentionally contains host-b (duplicate) and new host-c.
    const page2Items = [
      { sid: 'host-b.example.com', transport: 'agent' as const, status: 'connected' as const, registered_at: '2026-05-01T00:00:00Z' },
      { sid: 'host-c.example.com', transport: 'agent' as const, status: 'connected' as const, registered_at: '2026-05-01T00:00:00Z' },
    ];

    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url.includes('cursor=tok')) {
        return new Response(JSON.stringify({
          items: page2Items,
          offset: 0, limit: 100, total: 0, total_approximate: true,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        items: page1Items,
        offset: 0, limit: 100, total: 4, total_approximate: true,
        next_cursor: 'tok',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const user = userEvent.setup();
    renderWithProviders(<SoulsList />, '/souls');

    // Wait for the first page.
    await waitFor(() => {
      expect(screen.getByText('host-a.example.com')).toBeInTheDocument();
      expect(screen.getByText('host-b.example.com')).toBeInTheDocument();
    });

    // Click "Load more" — page 2 with host-b duplicate arrives.
    await user.click(screen.getByTestId('load-more-btn'));

    // Wait for host-c from page 2.
    await waitFor(() => {
      expect(screen.getByText('host-c.example.com')).toBeInTheDocument();
    });

    // All three unique sids are present.
    expect(screen.getByText('host-a.example.com')).toBeInTheDocument();
    expect(screen.getByText('host-b.example.com')).toBeInTheDocument();
    expect(screen.getByText('host-c.example.com')).toBeInTheDocument();

    // Invariant: host-b renders EXACTLY ONCE (dedup works).
    const hostBElements = screen.getAllByText('host-b.example.com');
    expect(hostBElements).toHaveLength(1);

    // Final number of data table rows = 3 (not 4).
    const rows = document.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
  });

  // Guard: empty souls list in keyset mode (scoped operator with zero coverage).
  // Invariant: no "Load more" button; empty-state renders; app does not crash.
  it('пустой список (keyset, items=[]): нет кнопки «ещё», рендерится empty-state', async () => {
    const fetchSpy = vi.fn(async () => {
      return new Response(JSON.stringify({
        items: [],
        offset: 0, limit: 100, total: 0, total_approximate: true,
        // next_cursor absent — scoped response with zero coverage
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchSpy);

    renderWithProviders(<SoulsList />, '/souls');

    // Wait for loading to finish.
    // With items=[] the component shows an empty-state with a "Connect Soul" button
    // (souls:registerSoul = "Connect Soul" from the ru bundle).
    await screen.findByRole('button', { name: /Подключить Soul/i });

    // "Load more" button must not be present (no next_cursor).
    expect(screen.queryByTestId('load-more-btn')).not.toBeInTheDocument();

    // No data table.
    expect(document.querySelector('tbody')).not.toBeInTheDocument();
  });

  // Guard: the badge while search is active shows visible.length, NOT the server/loaded total.
  // Invariant: the badge "doesn't lie" — counter = number of visible rows.
  it('search: бейдж показывает visible.length (найдено), не серверный total', async () => {
    const fetchSpy = vi.fn(async () => {
      return new Response(JSON.stringify({
        items: [
          { sid: 'host-alpha.example.com', transport: 'agent' as const, status: 'connected' as const, registered_at: '2026-05-01T00:00:00Z' },
          { sid: 'host-beta.example.com', transport: 'agent' as const, status: 'connected' as const, registered_at: '2026-05-01T00:00:00Z' },
          { sid: 'host-gamma.example.com', transport: 'agent' as const, status: 'connected' as const, registered_at: '2026-05-01T00:00:00Z' },
        ],
        offset: 0, limit: 100, total: 42, total_approximate: true,
        next_cursor: 'tok1',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const user = userEvent.setup();
    renderWithProviders(<SoulsList />, '/souls');

    // Wait for all three records to load.
    await waitFor(() => {
      expect(screen.getByText('host-alpha.example.com')).toBeInTheDocument();
      expect(screen.getByText('host-beta.example.com')).toBeInTheDocument();
      expect(screen.getByText('host-gamma.example.com')).toBeInTheDocument();
    });

    // Without search: the ≈ badge (total_approximate=true) is present, count-filtered is absent.
    const approxBefore = screen.getByTestId('count-approximate');
    expect(approxBefore).toBeInTheDocument();
    expect(approxBefore.textContent).toContain('≈');
    expect(screen.queryByTestId('count-filtered')).not.toBeInTheDocument();

    // Type search "alpha" — the table narrows to 1 row.
    const searchInput = screen.getByLabelText('search SID');
    await user.type(searchInput, 'alpha');

    await waitFor(() => {
      expect(screen.queryByText('host-beta.example.com')).not.toBeInTheDocument();
      expect(screen.queryByText('host-gamma.example.com')).not.toBeInTheDocument();
    });
    expect(screen.getByText('host-alpha.example.com')).toBeInTheDocument();

    // Badge must switch to count-filtered with visible.length=1.
    const filteredBadge = screen.getByTestId('count-filtered');
    expect(filteredBadge).toBeInTheDocument();
    // Text = "Found: 1", does NOT contain ≈ and does NOT contain "42".
    expect(filteredBadge.textContent).toContain('1');
    expect(filteredBadge.textContent).not.toContain('≈');
    expect(filteredBadge.textContent).not.toContain('42');
    // count-approximate is hidden while search is active.
    expect(screen.queryByTestId('count-approximate')).not.toBeInTheDocument();

    // Clear the search — the badge returns to the ≈ form.
    await user.clear(searchInput);

    await waitFor(() => {
      expect(screen.getByText('host-alpha.example.com')).toBeInTheDocument();
      expect(screen.getByText('host-beta.example.com')).toBeInTheDocument();
      expect(screen.getByText('host-gamma.example.com')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('count-filtered')).not.toBeInTheDocument();
    const approxAfter = screen.getByTestId('count-approximate');
    expect(approxAfter).toBeInTheDocument();
    expect(approxAfter.textContent).toContain('≈');
  });

  // Guard: when souls.list rejects on "Load more" — an inline error renders,
  // the button becomes available again for retry (FIX 2).
  it('loadMore error: реджект показывает inline-ошибку, кнопка снова активна', async () => {
    let callCount = 0;
    const fetchSpy = vi.fn(async () => {
      callCount++;
      // First request (no cursor) — successful, returns next_cursor.
      if (callCount === 1) {
        return new Response(JSON.stringify({
          items: [
            { sid: 'host01.example.com', transport: 'agent', status: 'connected', registered_at: '2026-05-01T00:00:00Z' },
          ],
          offset: 0,
          limit: 100,
          total: 5,
          total_approximate: true,
          next_cursor: 'tok1',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      // Second request (cursor=tok1) — 500.
      return new Response(JSON.stringify({ error: 'internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const user = userEvent.setup();
    renderWithProviders(<SoulsList />, '/souls');

    // Wait for the first page.
    await waitFor(() => {
      expect(screen.getByText('host01.example.com')).toBeInTheDocument();
    });

    // "Load more" button must be visible.
    const btn = screen.getByTestId('load-more-btn');
    expect(btn).not.toBeDisabled();

    // Click — the second request returns 500.
    await user.click(btn);

    // Inline error must appear.
    await waitFor(() => {
      expect(screen.getByTestId('load-more-error')).toBeInTheDocument();
    });

    // Button is active again (not disabled) — the operator can retry.
    expect(screen.getByTestId('load-more-btn')).not.toBeDisabled();

    // First page is still displayed (accumulator not reset).
    expect(screen.getByText('host01.example.com')).toBeInTheDocument();
  });
});

describe('soulprintFilter — parse', () => {
  it('одно простое правило', () => {
    const r = parseSoulprintFilter('os.family=debian');
    expect(r.invalid).toEqual([]);
    expect(r.rules).toEqual([{ path: 'os.family', op: '=', value: 'debian' }]);
  });

  it('compound AND через пробел и &', () => {
    const r = parseSoulprintFilter('os.family=debian & memory.total_mb>=4096');
    expect(r.invalid).toEqual([]);
    expect(r.rules).toEqual([
      { path: 'os.family', op: '=', value: 'debian' },
      { path: 'memory.total_mb', op: '>=', value: 4096 },
    ]);
  });

  it('wildcard в значении сохраняется как строка', () => {
    const r = parseSoulprintFilter('kernel.version=6.*');
    expect(r.rules).toEqual([{ path: 'kernel.version', op: '=', value: '6.*' }]);
  });

  it('невалидный токен попадает в invalid', () => {
    const r = parseSoulprintFilter('garbage');
    expect(r.rules).toEqual([]);
    expect(r.invalid).toEqual(['garbage']);
  });

  it('!= оператор', () => {
    const r = parseSoulprintFilter('os.distro!=ubuntu');
    expect(r.rules).toEqual([{ path: 'os.distro', op: '!=', value: 'ubuntu' }]);
  });
});

describe('soulprintFilter — eval', () => {
  const sp = {
    os: { family: 'debian', distro: 'ubuntu', pkg_mgr: 'apt' },
    kernel: { version: '6.1.0-26-generic', release: '6.1.0' },
    memory: { total_mb: 8192 },
    network: { primary_ip: '10.0.0.5' },
  };

  it('= по строке матчит', () => {
    expect(evalRule(sp, { path: 'os.family', op: '=', value: 'debian' })).toBe(true);
    expect(evalRule(sp, { path: 'os.family', op: '=', value: 'rhel' })).toBe(false);
  });

  it('wildcard 6.* матчит 6.1.0-26-generic', () => {
    expect(evalRule(sp, { path: 'kernel.version', op: '=', value: '6.*' })).toBe(true);
    expect(evalRule(sp, { path: 'kernel.version', op: '=', value: '5.*' })).toBe(false);
  });

  it('integer compare >=', () => {
    expect(evalRule(sp, { path: 'memory.total_mb', op: '>=', value: 4096 })).toBe(true);
    expect(evalRule(sp, { path: 'memory.total_mb', op: '>=', value: 16384 })).toBe(false);
  });

  it('network.primary_ip wildcard', () => {
    expect(evalRule(sp, { path: 'network.primary_ip', op: '=', value: '10.0.*' })).toBe(true);
    expect(evalRule(sp, { path: 'network.primary_ip', op: '=', value: '192.168.*' })).toBe(false);
  });

  it('неизвестный путь → false (хост исключается)', () => {
    expect(evalRule(sp, { path: 'os.codename', op: '=', value: 'jammy' })).toBe(false);
  });

  it('compound AND', () => {
    const ok = applyFilter(sp, [
      { path: 'os.family', op: '=', value: 'debian' },
      { path: 'memory.total_mb', op: '>=', value: 4096 },
    ]);
    expect(ok).toBe(true);
    const fail = applyFilter(sp, [
      { path: 'os.family', op: '=', value: 'debian' },
      { path: 'memory.total_mb', op: '>=', value: 16384 },
    ]);
    expect(fail).toBe(false);
  });

  it('пустой набор правил → всегда true', () => {
    expect(applyFilter(sp, [])).toBe(true);
  });
});
