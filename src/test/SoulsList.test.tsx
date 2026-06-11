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

// Хелпер с маршрутами для bulk-run тестов: SoulsList + landing-stub /run.
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
    // 'connected' встречается и в <option> select-фильтра, и в Badge —
    // поэтому матчим все вхождения и убеждаемся, что Badge отрендерился.
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

    // Bulk Run кнопка должна быть disabled до выбора.
    const runBtn = screen.getByRole('button', { name: /Bulk Run on selected/ });
    expect(runBtn).toBeDisabled();

    // Выбираем оба host-а через row-checkbox.
    await user.click(screen.getByLabelText('выбрать host01.example.com'));
    await user.click(screen.getByLabelText('выбрать host02.example.com'));

    // Counter в кнопке.
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
    // CSV допускает как `host01,host02`, так и URL-encoded запятую.
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

  // Guard: при наличии next_cursor в ответе — кнопка «Загрузить ещё» рендерится;
  // по клику — следующий запрос несёт cursor= в URL.
  it('показывает кнопку «Загрузить ещё» при наличии next_cursor, передаёт cursor в следующий запрос', async () => {
    const page1Items = [
      { sid: 'host01.example.com', transport: 'agent' as const, status: 'connected' as const, registered_at: '2026-05-01T00:00:00Z' },
      { sid: 'host02.example.com', transport: 'agent' as const, status: 'connected' as const, registered_at: '2026-05-01T00:00:00Z' },
    ];
    const page2Items = [
      { sid: 'host03.example.com', transport: 'agent' as const, status: 'connected' as const, registered_at: '2026-05-01T00:00:00Z' },
    ];

    // fetchMock: первый запрос без cursor= → page1; с cursor=tok1 → page2.
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url.includes('cursor=tok1')) {
        return new Response(JSON.stringify({
          items: page2Items,
          offset: 0,
          limit: 100,
          total: 0,
          total_approximate: true,
          // next_cursor отсутствует → последняя страница
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

    // Ждём первую страницу.
    await waitFor(() => {
      expect(screen.getByText('host01.example.com')).toBeInTheDocument();
      expect(screen.getByText('host02.example.com')).toBeInTheDocument();
    });

    // Кнопка «Загрузить ещё» должна быть видна (есть next_cursor).
    const btn = screen.getByTestId('load-more-btn');
    expect(btn).toBeInTheDocument();

    // Кликаем «Загрузить ещё».
    await user.click(btn);

    // Второй запрос должен содержать cursor=tok1 в URL.
    await waitFor(() => {
      expect(screen.getByText('host03.example.com')).toBeInTheDocument();
    });

    // Первая страница тоже должна присутствовать (аккумуляция).
    expect(screen.getByText('host01.example.com')).toBeInTheDocument();
    expect(screen.getByText('host02.example.com')).toBeInTheDocument();

    // Кнопки «Загрузить ещё» больше нет (next_cursor исчез).
    expect(screen.queryByTestId('load-more-btn')).not.toBeInTheDocument();

    // Проверяем, что второй fetch-вызов содержал cursor= в URL.
    const calls = fetchSpy.mock.calls;
    const cursorCall = calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      return url.includes('cursor=tok1');
    });
    expect(cursorCall).toBeDefined();
  });

  // Guard: total_approximate=true → рендерится элемент с маркером приблизительности.
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

    // Элемент с приблизительным счётчиком должен быть в DOM.
    const countEl = screen.getByTestId('count-approximate');
    expect(countEl).toBeInTheDocument();
    // Должен содержать маркер ≈.
    expect(countEl.textContent).toContain('≈');
  });

  // Guard: total_approximate=false (offset-режим, нет next_cursor) → кнопки «ещё» нет,
  // маркера приблизительности нет (регресс coven-режима).
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
          // total_approximate отсутствует (false по умолчанию), next_cursor отсутствует.
        },
      },
    ]);
    renderWithProviders(<SoulsList />, '/souls');

    await waitFor(() => {
      expect(screen.getByText('host01.example.com')).toBeInTheDocument();
    });

    // Кнопки «Загрузить ещё» не должно быть.
    expect(screen.queryByTestId('load-more-btn')).not.toBeInTheDocument();
    // Маркера приблизительности не должно быть.
    expect(screen.queryByTestId('count-approximate')).not.toBeInTheDocument();
  });

  // Guard: race-condition — смена фильтра во время in-flight loadMore.
  // Без фикса: in-flight ответ фильтра A подмешивался в набор фильтра B.
  // С фиксом: in-flight результат отбрасывается, набор B остаётся чистым.
  it('loadMore in-flight: смена фильтра отбрасывает старый ответ, набор нового фильтра чист', async () => {
    // Deferred-промис для второго запроса фильтра A (страница 2).
    // Резолвим вручную ПОСЛЕ смены фильтра.
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
      // Запрос 1: фильтр A, страница 1 (без cursor, без status-param → filterA).
      if (callCount === 1) {
        return new Response(JSON.stringify({
          items: filterAPage1Items,
          offset: 0, limit: 100, total: 2, total_approximate: true,
          next_cursor: 'cursor-a1',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      // Запрос 2: loadMore фильтра A (cursor=cursor-a1) — задерживаем.
      if (url.includes('cursor=cursor-a1')) {
        return loadMoreAPromise;
      }
      // Запрос 3: фильтр B, страница 1 (status=disconnected).
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

    // Ждём первую страницу фильтра A.
    await waitFor(() => {
      expect(screen.getByText('filter-a-host01.example.com')).toBeInTheDocument();
    });

    // Кликаем «Загрузить ещё» — второй запрос (cursor-a1) уходит и зависает.
    const btn = screen.getByTestId('load-more-btn');
    await user.click(btn);

    // Меняем фильтр на «disconnected» — useQuery запускает запрос 3,
    // аккумулятор сбрасывается на filterB, cursor обнуляется.
    const statusSelect = screen.getByRole('combobox', { name: /Status/i });
    await user.selectOptions(statusSelect, 'disconnected');

    // Ждём пока фильтр B отрендерится.
    await waitFor(() => {
      expect(screen.getByText('filter-b-host01.example.com')).toBeInTheDocument();
    });

    // Теперь резолвим задержанный ответ фильтра A — с фиксом он должен быть отброшен.
    resolveLoadMoreA(new Response(JSON.stringify({
      items: filterAPage2Items,
      offset: 0, limit: 100, total: 0, total_approximate: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    // Даём React время на обработку.
    await waitFor(() => {
      // filter-b-host01 должен присутствовать.
      expect(screen.getByText('filter-b-host01.example.com')).toBeInTheDocument();
    });

    // Критические ассерты: элементы фильтра A НЕ должны присутствовать.
    expect(screen.queryByText('filter-a-host01.example.com')).not.toBeInTheDocument();
    expect(screen.queryByText('filter-a-host02.example.com')).not.toBeInTheDocument();

    // Кнопки «Загрузить ещё» нет — у фильтра B нет next_cursor.
    expect(screen.queryByTestId('load-more-btn')).not.toBeInTheDocument();
  });

  // Guard: дедупликация по sid при ПЕРЕСЕКАЮЩИХСЯ страницах.
  // Страница A: host-a, host-b (next_cursor=tok). Страница B (cursor=tok): host-b (дубль!), host-c.
  // Инвариант: host-b рендерится РОВНО один раз; итоговых строк = 3, не 4.
  it('дедуп: перекрывающиеся страницы — дубль sid рендерится ровно один раз', async () => {
    const page1Items = [
      { sid: 'host-a.example.com', transport: 'agent' as const, status: 'connected' as const, registered_at: '2026-05-01T00:00:00Z' },
      { sid: 'host-b.example.com', transport: 'agent' as const, status: 'connected' as const, registered_at: '2026-05-01T00:00:00Z' },
    ];
    // Страница 2 намеренно содержит host-b (дубль) и новый host-c.
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

    // Ждём первую страницу.
    await waitFor(() => {
      expect(screen.getByText('host-a.example.com')).toBeInTheDocument();
      expect(screen.getByText('host-b.example.com')).toBeInTheDocument();
    });

    // Кликаем «Загрузить ещё» — придёт страница 2 с дублем host-b.
    await user.click(screen.getByTestId('load-more-btn'));

    // Ждём host-c из страницы 2.
    await waitFor(() => {
      expect(screen.getByText('host-c.example.com')).toBeInTheDocument();
    });

    // Все три уникальных sid присутствуют.
    expect(screen.getByText('host-a.example.com')).toBeInTheDocument();
    expect(screen.getByText('host-b.example.com')).toBeInTheDocument();
    expect(screen.getByText('host-c.example.com')).toBeInTheDocument();

    // Инвариант: host-b рендерится РОВНО ОДИН раз (дедуп работает).
    const hostBElements = screen.getAllByText('host-b.example.com');
    expect(hostBElements).toHaveLength(1);

    // Итоговое число строк таблицы с данными = 3 (не 4).
    const rows = document.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
  });

  // Guard: пустой список souls в keyset-режиме (scoped-оператор с нулевым покрытием).
  // Инвариант: кнопка «Загрузить ещё» отсутствует; рендерится empty-state; приложение не падает.
  it('пустой список (keyset, items=[]): нет кнопки «ещё», рендерится empty-state', async () => {
    const fetchSpy = vi.fn(async () => {
      return new Response(JSON.stringify({
        items: [],
        offset: 0, limit: 100, total: 0, total_approximate: true,
        // next_cursor отсутствует — scoped-ответ с нулевым покрытием
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchSpy);

    renderWithProviders(<SoulsList />, '/souls');

    // Ждём завершения загрузки.
    // При items=[] компонент показывает empty-state с кнопкой «Подключить Soul»
    // (souls:registerSoul = "Подключить Soul" из ru-бандла).
    await screen.findByRole('button', { name: /Подключить Soul/i });

    // Кнопки «Загрузить ещё» не должно быть (нет next_cursor).
    expect(screen.queryByTestId('load-more-btn')).not.toBeInTheDocument();

    // Таблицы с данными нет.
    expect(document.querySelector('tbody')).not.toBeInTheDocument();
  });

  // Guard: бейдж при активном поиске показывает visible.length, НЕ серверный/загруженный total.
  // Инвариант: бейдж «не врёт» — счётчик = число видимых строк.
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

    // Ждём загрузки всех трёх записей.
    await waitFor(() => {
      expect(screen.getByText('host-alpha.example.com')).toBeInTheDocument();
      expect(screen.getByText('host-beta.example.com')).toBeInTheDocument();
      expect(screen.getByText('host-gamma.example.com')).toBeInTheDocument();
    });

    // Без поиска: бейдж ≈ (total_approximate=true) присутствует, count-filtered отсутствует.
    const approxBefore = screen.getByTestId('count-approximate');
    expect(approxBefore).toBeInTheDocument();
    expect(approxBefore.textContent).toContain('≈');
    expect(screen.queryByTestId('count-filtered')).not.toBeInTheDocument();

    // Вводим поиск «alpha» — таблица сужается до 1 строки.
    const searchInput = screen.getByLabelText('search SID');
    await user.type(searchInput, 'alpha');

    await waitFor(() => {
      expect(screen.queryByText('host-beta.example.com')).not.toBeInTheDocument();
      expect(screen.queryByText('host-gamma.example.com')).not.toBeInTheDocument();
    });
    expect(screen.getByText('host-alpha.example.com')).toBeInTheDocument();

    // Бейдж должен переключиться на count-filtered с visible.length=1.
    const filteredBadge = screen.getByTestId('count-filtered');
    expect(filteredBadge).toBeInTheDocument();
    // Текст = «Найдено: 1», НЕ содержит ≈ и НЕ содержит «42».
    expect(filteredBadge.textContent).toContain('1');
    expect(filteredBadge.textContent).not.toContain('≈');
    expect(filteredBadge.textContent).not.toContain('42');
    // count-approximate скрыт при активном поиске.
    expect(screen.queryByTestId('count-approximate')).not.toBeInTheDocument();

    // Очищаем поиск — бейдж возвращается к ≈-форме.
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

  // Guard: когда souls.list при «Загрузить ещё» реджектит — рендерится inline-ошибка,
  // кнопка снова доступна для повтора (FIX 2).
  it('loadMore error: реджект показывает inline-ошибку, кнопка снова активна', async () => {
    let callCount = 0;
    const fetchSpy = vi.fn(async () => {
      callCount++;
      // Первый запрос (без cursor) — успешный, возвращает next_cursor.
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
      // Второй запрос (cursor=tok1) — 500.
      return new Response(JSON.stringify({ error: 'internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const user = userEvent.setup();
    renderWithProviders(<SoulsList />, '/souls');

    // Ждём первую страницу.
    await waitFor(() => {
      expect(screen.getByText('host01.example.com')).toBeInTheDocument();
    });

    // Кнопка «Загрузить ещё» должна быть видна.
    const btn = screen.getByTestId('load-more-btn');
    expect(btn).not.toBeDisabled();

    // Кликаем — второй запрос вернёт 500.
    await user.click(btn);

    // Inline-ошибка должна появиться.
    await waitFor(() => {
      expect(screen.getByTestId('load-more-error')).toBeInTheDocument();
    });

    // Кнопка снова активна (не disabled) — оператор может повторить.
    expect(screen.getByTestId('load-more-btn')).not.toBeDisabled();

    // Первая страница по-прежнему отображается (аккумулятор не сброшен).
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
