import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ErrandNewForm } from '../pages/errands/ErrandNewForm';
import { tokenStore } from '../api/tokenStore';

// Кастомный render: помимо стандартного renderWithProviders ставим Routes,
// чтобы после submit redirect /errands/:id рендерил видимый маркер.
function renderWithRoutes(initialPath: string) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrap({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(
    <Routes>
      <Route path="/errands/new" element={<ErrandNewForm />} />
      <Route path="/errands/:id" element={<div data-testid="detail-page" />} />
    </Routes>,
    { wrapper: Wrap },
  );
}

// Каталог errand-safe модулей — отдаёт backend, UI фетчит.
const ERRAND_SAFE_CATALOG = {
  items: [
    {
      name: 'core.cmd.shell',
      kind: 'core',
      states: ['shell'],
      errand_safe: true,
      params: [],
    },
    {
      name: 'core.exec.run',
      kind: 'core',
      states: ['run'],
      errand_safe: true,
      params: [],
    },
    {
      name: 'core.http.probe',
      kind: 'core',
      states: ['probe'],
      errand_safe: true,
      params: [],
    },
  ],
};

const SYNC_RESULT = {
  errand_id: '01HZAA0000000000000000000B',
  sid: 'host01.example.com',
  module: 'core.cmd.shell',
  status: 'success' as const,
  exit_code: 0,
  stdout: 'hello',
  duration_ms: 42,
  started_by_aid: 'archon-alice',
  started_at: '2026-05-26T10:00:00Z',
  finished_at: '2026-05-26T10:00:00Z',
};

// Базовый fetch-мок: каталог модулей + список souls (пустой).
function makeBaseFetch(overrides?: (url: string, method: string, init?: RequestInit) => Response | null) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();

    const override = overrides?.(url, method, init);
    if (override) return override;

    if (method === 'GET' && url.includes('/v1/modules')) {
      return new Response(JSON.stringify(ERRAND_SAFE_CATALOG), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (method === 'GET' && url.includes('/v1/souls')) {
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 200, total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 404 });
  };
}

describe('ErrandNewForm', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  it('shell: zod-валидация — пустой SID и команда блокируют submit', async () => {
    vi.stubGlobal('fetch', makeBaseFetch());
    renderWithRoutes('/errands/new');
    const user = userEvent.setup();

    // Ждём загрузки каталога (select должен отрендерить опции из фетча)
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'core.cmd.shell' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Run Errand/i }));
    await waitFor(() => {
      expect(screen.getByText(/SID обязателен/i)).toBeInTheDocument();
      expect(screen.getByText(/команда обязательна/i)).toBeInTheDocument();
    });
  });

  it('shell: 200 sync → редирект на /errands/:id', async () => {
    let postedBody: unknown = null;
    vi.stubGlobal('fetch', makeBaseFetch((url, method, init) => {
      if (method === 'POST' && url.includes('/v1/souls/') && url.includes('/exec')) {
        postedBody = init?.body ? JSON.parse(init.body as string) : null;
        return new Response(JSON.stringify(SYNC_RESULT), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return null;
    }));

    renderWithRoutes('/errands/new');
    const user = userEvent.setup();

    // Ждём загрузки каталога
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'core.cmd.shell' })).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText(/host01.example.com/i), 'host01.example.com');
    await user.type(screen.getByPlaceholderText(/uptime/i), 'uptime');
    await user.click(screen.getByRole('button', { name: /Run Errand/i }));

    await waitFor(() => {
      expect(screen.getByTestId('detail-page')).toBeInTheDocument();
    });
    expect(postedBody).toMatchObject({
      module: 'core.cmd.shell',
      input: { cmd: 'uptime' },
    });
  });

  it('каталог содержит core.http.probe — видим в select, клик → CustomForm (JSON-textarea)', async () => {
    vi.stubGlobal('fetch', makeBaseFetch());
    renderWithRoutes('/errands/new');
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'core.http.probe' })).toBeInTheDocument();
    });

    // Выбираем core.http.probe → должна открыться CustomForm.
    // CustomForm монтируется с kind==='custom', рендерит JSON-textarea (params_json).
    await user.selectOptions(screen.getByLabelText(/Module kind/i), '__m:core.http.probe');
    await waitFor(() => {
      // CustomForm рендерит aria-label="Custom module"
      expect(screen.getByRole('form', { name: /Custom module/i })).toBeInTheDocument();
    });
    // Поле модуля содержит prefill из каталога
    const moduleInput = screen.getByLabelText(/module name/i);
    expect(moduleInput).toHaveValue('core.http.probe');
  });

  it('переключение на custom-module: невалидный JSON ловится zod-ом', async () => {
    vi.stubGlobal('fetch', makeBaseFetch());
    renderWithRoutes('/errands/new');
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'core.cmd.shell' })).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText(/Module kind/i), '__custom__');
    await user.type(screen.getByPlaceholderText(/host01.example.com/i), 'host01');
    const ta = screen.getByPlaceholderText(/url.*example/i);
    await user.clear(ta);
    // userEvent.type интерпретирует `{` как special, экранируем: `{{`.
    await user.type(ta, '{{not-json');
    await user.click(screen.getByRole('button', { name: /Run Errand/i }));
    await waitFor(() => {
      expect(screen.getByText(/невалидный JSON-object/i)).toBeInTheDocument();
    });
  });

  it('?sid=… в query-параметре подставляет prefilled-SID', async () => {
    vi.stubGlobal('fetch', makeBaseFetch());
    renderWithRoutes('/errands/new?sid=fixed.example.com');
    await waitFor(() => {
      const input = screen.getByDisplayValue('fixed.example.com');
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('readonly');
    });
  });
});
