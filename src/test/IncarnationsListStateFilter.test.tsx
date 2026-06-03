// Тесты: state-фильтр инкарнаций (ADR-042 тупой фронт + server-side sort + snapshot Run).
//
// Проверяем:
// 1. Панель фильтра не появляется без выбора сервиса.
// 2. При выборе сервиса — фетчится state-schema, поля берутся из схемы (не хардкод).
// 3. Добавление предиката → запрос к /v1/incarnations с state.<field>=<op>:<value>.
// 4. 422 от backend → per-field ошибка, не краш.
// 5. Server-side sort: сортировка передаётся как sort/sort_dir, не client-side.
// 6. Счётчик total из ответа backend.
// 7. Кнопка «Run по набору» → navigate с service + incarnation_regex (param НЕ incarnation).
// 8. RunWizard с ?incarnation_regex=... реально резолвит список инкарнаций (не экранированный литерал).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { renderWithProviders } from './renderWithProviders';
import { IncarnationsList } from '../pages/incarnations/IncarnationsList';
import { RunWizard } from '../pages/run/RunWizard';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

const SERVICES_REPLY = {
  items: [{ name: 'redis', ref: 'main' }, { name: 'postgres', ref: 'v2' }],
  total: 2,
};

const STATE_SCHEMA_REPLY = {
  service: 'redis',
  ref: 'main',
  state_schema_version: 1,
  schema: {
    type: 'object',
    required: ['redis_version'],
    properties: {
      redis_version: { type: 'string' },
      maxmemory: { type: 'integer' },
    },
  },
  migrations: [],
};

const INCARNATIONS_REPLY = {
  items: [
    {
      name: 'redis-prod',
      service: 'redis',
      service_version: 'main',
      status: 'ready',
      covens: ['prod'],
      created_at: new Date().toISOString(),
      last_drift_check_at: null,
      spec: {},
      state: {},
    },
    {
      name: 'redis-staging',
      service: 'redis',
      service_version: 'main',
      status: 'ready',
      covens: ['staging'],
      created_at: new Date().toISOString(),
      last_drift_check_at: null,
      spec: {},
      state: {},
    },
  ],
  total: 2,
};

// Ждём пока select получит option с нужным value.
async function waitForOption(select: HTMLElement, value: string) {
  await waitFor(() => {
    const opt = within(select as HTMLSelectElement).queryByRole('option', { name: value });
    expect(opt).toBeInTheDocument();
  });
}

describe('IncarnationsList — state filter', () => {
  beforeEach(() => {
    tokenStore.clear();
    navigateSpy.mockReset();
  });

  it('панель state-фильтра скрыта без выбора сервиса', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/services', body: SERVICES_REPLY },
      { method: 'GET', url: '/v1/incarnations', body: { items: [], total: 0 } },
    ]);
    renderWithProviders(<IncarnationsList />, '/incarnations');
    await waitFor(() => {
      expect(screen.getAllByText(/выберите сервис для фильтрации по state/i).length).toBeGreaterThan(0);
    });
    // Кнопки «Добавить условие» не должно быть, пока сервис не выбран.
    expect(screen.queryByText(/добавить условие/i)).not.toBeInTheDocument();
  });

  it('поля берутся из схемы (не хардкод) после выбора сервиса', async () => {
    // Более специфичный маршрут (/v1/services/redis/state-schema) должен быть раньше
    // общего (/v1/services), иначе startsWith-матчинг выберет неверный route.
    installFetchMock([
      { method: 'GET', url: '/v1/services/redis/state-schema', body: STATE_SCHEMA_REPLY },
      { method: 'GET', url: '/v1/services', body: SERVICES_REPLY },
      { method: 'GET', url: '/v1/incarnations', body: INCARNATIONS_REPLY },
    ]);
    renderWithProviders(<IncarnationsList />, '/incarnations');

    // Ждём загрузки services (option redis появляется в select).
    const allSelects = screen.getAllByRole('combobox');
    const serviceSelect = allSelects[0]; // первый select = сервис
    await waitForOption(serviceSelect, 'redis');
    await userEvent.selectOptions(serviceSelect, 'redis');

    // Ждём появления кнопки «Добавить условие» (панель загружает схему).
    const addBtn = await screen.findByRole('button', { name: /добавить условие/i });

    // Добавляем предикат.
    await userEvent.click(addBtn);

    // Проверяем: в select поля схемы redis_version и maxmemory (не хардкод — из схемы).
    const fieldSelect = screen.getByRole('combobox', { name: /поле state/i });
    const options = within(fieldSelect).getAllByRole('option');
    const optionValues = options.map((o) => o.textContent);
    expect(optionValues).toContain('redis_version');
    expect(optionValues).toContain('maxmemory');
  });

  it('отправляет state.<field>=<op>:<value> при заполненном предикате', async () => {
    let capturedUrl: string | null = null;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (urlStr.startsWith('/v1/services/redis/state-schema')) {
        return new Response(JSON.stringify(STATE_SCHEMA_REPLY), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.startsWith('/v1/services')) {
        return new Response(JSON.stringify(SERVICES_REPLY), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'GET' && urlStr.startsWith('/v1/incarnations')) {
        capturedUrl = urlStr;
        return new Response(JSON.stringify(INCARNATIONS_REPLY), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ title: 'not mocked', detail: urlStr }), { status: 599 });
    }) as typeof fetch;

    renderWithProviders(<IncarnationsList />, '/incarnations');

    const allSelects = screen.getAllByRole('combobox');
    await waitForOption(allSelects[0], 'redis');
    await userEvent.selectOptions(allSelects[0], 'redis');

    const addBtn2 = await screen.findByRole('button', { name: /добавить условие/i });
    await userEvent.click(addBtn2);

    // Выбираем поле maxmemory.
    const fieldSelect = screen.getByRole('combobox', { name: /поле state/i });
    await userEvent.selectOptions(fieldSelect, 'maxmemory');

    // Устанавливаем оператор gte.
    const opSelect = screen.getByRole('combobox', { name: /оператор/i });
    await userEvent.selectOptions(opSelect, 'gte');

    // Вводим значение.
    const valueInput = screen.getByRole('spinbutton', { name: /значение/i });
    await userEvent.clear(valueInput);
    await userEvent.type(valueInput, '1024');

    // Ждём запроса с state-предикатом.
    await waitFor(() => {
      expect(capturedUrl).not.toBeNull();
      // URL содержит state.maxmemory=gte:1024 (URL-encoded).
      expect(decodeURIComponent(capturedUrl!)).toContain('state.maxmemory=gte:1024');
    }, { timeout: 3000 });
  });

  it('422 от backend → показывает ошибку, не краш', async () => {
    // Первый запрос к incarnations отдаём 422 сразу (без state-фильтров).
    // Чтобы 422 сработал при заполненном предикате — создаём мок,
    // который возвращает 422 всегда для /v1/incarnations.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (urlStr.startsWith('/v1/services/redis/state-schema')) {
        return new Response(JSON.stringify(STATE_SCHEMA_REPLY), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.startsWith('/v1/services')) {
        return new Response(JSON.stringify(SERVICES_REPLY), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'GET' && urlStr.startsWith('/v1/incarnations')) {
        // Если запрос содержит state-предикат — возвращаем 422.
        if (urlStr.includes('state.')) {
          return new Response(
            JSON.stringify({ title: 'Unprocessable Entity', detail: 'state.maxmemory: non-numeric value for operator gte' }),
            { status: 422, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ items: [], total: 0 }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 599 });
    }) as typeof fetch;

    renderWithProviders(<IncarnationsList />, '/incarnations');

    const allSelects = screen.getAllByRole('combobox');
    await waitForOption(allSelects[0], 'redis');
    await userEvent.selectOptions(allSelects[0], 'redis');

    await waitFor(() => {
      expect(screen.getByText(/добавить условие/i)).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText(/добавить условие/i));

    const fieldSelect = screen.getByRole('combobox', { name: /поле state/i });
    await userEvent.selectOptions(fieldSelect, 'maxmemory');

    const opSelect = screen.getByRole('combobox', { name: /оператор/i });
    await userEvent.selectOptions(opSelect, 'gte');

    const valueInput = screen.getByRole('spinbutton', { name: /значение/i });
    await userEvent.clear(valueInput);
    await userEvent.type(valueInput, '100');

    await waitFor(() => {
      expect(screen.getByText(/ошибка фильтра/i)).toBeInTheDocument();
    });
  });

  it('total из ответа backend отображается', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/services', body: SERVICES_REPLY },
      { method: 'GET', url: '/v1/incarnations', body: INCARNATIONS_REPLY },
    ]);
    renderWithProviders(<IncarnationsList />, '/incarnations');

    await waitFor(() => {
      expect(screen.getByText(/Итого: 2 инкарнаций/)).toBeInTheDocument();
    });
  });

  it('sort передаётся как query-param (server-side)', async () => {
    let capturedUrl: string | null = null;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.startsWith('/v1/services')) {
        return new Response(JSON.stringify(SERVICES_REPLY), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (method === 'GET' && urlStr.startsWith('/v1/incarnations')) {
        capturedUrl = urlStr;
        return new Response(JSON.stringify(INCARNATIONS_REPLY), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    renderWithProviders(<IncarnationsList />, '/incarnations');

    // По умолчанию sort=created_at desc.
    await waitFor(() => {
      expect(capturedUrl).not.toBeNull();
      expect(capturedUrl).toContain('sort=created_at');
      expect(capturedUrl).toContain('sort_dir=desc');
    });

    // Ждём рендера таблицы и кнопки сортировки.
    await waitFor(() => {
      expect(screen.getByText('redis-prod')).toBeInTheDocument();
    });

    // Кликаем по колонке Имя — должна смениться сортировка.
    capturedUrl = null;
    // Кнопка сортировки внутри th; найдём по полному тексту.
    const sortButtons = screen.getAllByRole('button');
    const nameBtn = sortButtons.find((b) => b.textContent?.trim().startsWith('Имя'));
    expect(nameBtn).toBeDefined();
    await userEvent.click(nameBtn!);

    await waitFor(() => {
      expect(capturedUrl).not.toBeNull();
      expect(capturedUrl).toContain('sort=name');
      expect(capturedUrl).toContain('sort_dir=asc');
    });
  });

  it('кнопка «Run по набору» вызывает navigate с service + incarnation regex (snapshot)', async () => {
    // Более специфичный маршрут (/v1/services/redis/state-schema) должен быть раньше
    // общего (/v1/services), иначе startsWith-матчинг выберет неверный route.
    installFetchMock([
      { method: 'GET', url: '/v1/services/redis/state-schema', body: STATE_SCHEMA_REPLY },
      { method: 'GET', url: '/v1/services', body: SERVICES_REPLY },
      { method: 'GET', url: '/v1/incarnations', body: INCARNATIONS_REPLY },
    ]);
    renderWithProviders(<IncarnationsList />, '/incarnations');

    const allSelects = screen.getAllByRole('combobox');
    await waitForOption(allSelects[0], 'redis');
    await userEvent.selectOptions(allSelects[0], 'redis');

    await waitFor(() => {
      expect(screen.getByText(/добавить условие/i)).toBeInTheDocument();
    });

    // Добавляем предикат: переключаем поле на maxmemory (integer → spinbutton),
    // затем вводим значение, чтобы предикат стал активным и появилась кнопка Run.
    await userEvent.click(screen.getByText(/добавить условие/i));
    const fieldSelect = screen.getByRole('combobox', { name: /поле state/i });
    await userEvent.selectOptions(fieldSelect, 'maxmemory');
    const valueInput = screen.getByRole('spinbutton', { name: /значение/i });
    await userEvent.type(valueInput, '100');

    // Ждём загрузки результатов.
    await waitFor(() => {
      expect(screen.getByText('redis-prod')).toBeInTheDocument();
    });

    // Кнопка «Run по набору» должна появиться.
    // aria-label = runSetAria = «Запустить сценарий...» — доступное имя для AT;
    // text-контент кнопки — «Run по набору».
    const runBtn = await screen.findByRole('button', { name: /запустить сценарий на отфильтрованном наборе/i });
    await userEvent.click(runBtn);

    expect(navigateSpy).toHaveBeenCalledOnce();
    const calledWith: string = navigateSpy.mock.calls[0][0];
    expect(calledWith).toContain('/run');
    expect(calledWith).toContain('service=redis');
    // КРИТИЧНО: param должен быть incarnation_regex (не incarnation).
    // incarnation (одиночное имя) RunWizard оборачивает в ^…$ — при snapshot-OR это
    // двойное экранирование, и regex не совпадёт ни с одной инкарнацией.
    expect(calledWith).toContain('incarnation_regex=');
    expect(calledWith).not.toContain('&incarnation=');
    // Regex должен содержать имена инкарнаций.
    const decoded = decodeURIComponent(calledWith);
    expect(decoded).toContain('redis-prod');
    expect(decoded).toContain('redis-staging');
  });

  it('RunWizard c ?incarnation_regex реально резолвит список (не экранированный литерал)', async () => {
    // Этот тест воспроизводит находку 1/2 review: snapshot-Run передавал regex через
    // param `incarnation`, который RunWizard повторно обрамлял в ^…$ → двойное экранирование
    // → incarnationRegex содержал escaped-литерал вместо живого OR-regex → 0 совпадений.
    //
    // После фикса IncarnationsList использует `incarnation_regex`, RunWizard кладёт его
    // as-is в incarnationRegex. Step3 должен показать обе инкарнации из совпавшего regex.

    const INCARNATION_NAMES = ['redis-prod', 'redis-staging'];
    const snapshotRegex = `^(${INCARNATION_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`;

    // Общий fetch-stub для RunWizard.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const json = (obj: unknown, status = 200) =>
        new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

      if (url.includes('/v1/services/redis/scenarios')) {
        return json({ service: 'redis', ref: 'main', scenarios: [{ name: 'restart', kind: 'operational' }] });
      }
      if (url.includes('/v1/services')) {
        return json({ items: [{ name: 'redis', ref: 'main' }], total: 1 });
      }
      if (url.includes('/v1/incarnations')) {
        return json({
          items: INCARNATION_NAMES.map((name) => ({
            name, service: 'redis', service_version: 'main',
            state_schema_version: 1, covens: ['prod'], status: 'ready',
            created_by_aid: 'archon-x', created_at: '', updated_at: '',
          })),
          total: INCARNATION_NAMES.length,
        });
      }
      if (url.includes('/v1/souls')) {
        return json({ items: [], total: 0 });
      }
      if (url.includes('/v1/modules')) {
        return json({ items: [] });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    // URL как будто пришёл из IncarnationsList.handleRunSet.
    const initialPath = `/run?workload=scenario&service=redis&incarnation_regex=${encodeURIComponent(snapshotRegex)}`;

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 }, mutations: { retry: false } },
    });
    function Wrap({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
        </QueryClientProvider>
      );
    }
    render(
      <Routes>
        <Route path="/run" element={<RunWizard />} />
      </Routes>,
      { wrapper: Wrap },
    );

    // Переходим Step1 → Step2.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Далее/ }));

    // В Step2 service уже выбран из query — выбираем scenario.
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    // Переходим Step2 → Step3 (incarnation regex).
    await user.click(screen.getByRole('button', { name: /Далее/ }));

    // incarnationRegex уже заполнен из ?incarnation_regex (не обёрнут повторно).
    // После загрузки incarnations список совпавших должен содержать ОБОИХ.
    await waitFor(() => {
      const matchList = screen.getByLabelText('Matched incarnations').textContent ?? '';
      // РЕАЛЬНАЯ ПРОВЕРКА: оба имени видны, а не пустой список из-за двойного экранирования.
      expect(matchList).toContain('redis-prod');
      expect(matchList).toContain('redis-staging');
    }, { timeout: 3000 });

    // Дополнительно: «Далее» не заблокирован (есть совпадения).
    expect(screen.getByRole('button', { name: /Далее/ })).not.toBeDisabled();
  });
});
