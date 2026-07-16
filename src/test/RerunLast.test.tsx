/**
 * Тесты для rerun-last (перезапуск последнего упавшего сценария из error_locked):
 * 1. runnableScenarios фильтрует по полю `runnable` (create виден, destroy нет, converge виден)
 * 2. Кнопка «Перезапустить последний упавший» видна только на error_locked
 * 3. Модалка требует reason (пустой = ошибка валидации)
 * 4. Happy-path: вызов с правильным телом → 202 (incl. scenario) → тост с именем сценария
 * 5. Обработка 409: не-error_locked и ErrRerunInputUnavailable — разные сообщения
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { IncarnationDetail } from '../pages/incarnations/IncarnationDetail';
import { runnableScenarios } from '../pages/incarnations/reservedScenarios';
import type { ServiceScenarioInfo } from '../api/keeper';
import { tokenStore } from '../api/tokenStore';

// Incarnation fixture with a given status.
function makeIncarnation(status: string) {
  return {
    name: 'test-inc',
    service: 'my-svc',
    service_version: 'v1.0.0',
    state_schema_version: 1,
    covens: [],
    spec: {},
    state: {},
    status,
    created_by_aid: 'archon-alice',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

// Fetch mock for incarnation-get.
function mockFetch(incBody: unknown, overrides?: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const method = (init?.method ?? 'GET').toUpperCase();

    if (overrides) {
      const key = `${method}:${urlStr}`;
      for (const [pattern, resp] of Object.entries(overrides)) {
        if (key.includes(pattern) || urlStr.includes(pattern)) {
          return new Response(JSON.stringify(resp.body), {
            status: resp.status,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    }
    return new Response(JSON.stringify(incBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
}

// ────────────────────────────────────────────────────────────
// 1. Filtering runnableScenarios by the runnable field
// ────────────────────────────────────────────────────────────
describe('runnableScenarios — фильтр по полю runnable', () => {
  const scenarios: ServiceScenarioInfo[] = [
    { name: 'create',   path: 'scenario/create/main.yml',   kind: 'lifecycle',    runnable: true },
    { name: 'destroy',  path: 'scenario/destroy/main.yml',  kind: 'lifecycle',    runnable: false },
    { name: 'converge', path: 'scenario/converge/main.yml', kind: 'lifecycle',    runnable: true },
    { name: 'restart',  path: 'scenario/restart/main.yml',  kind: 'operational',  runnable: true },
  ];

  it('create (runnable=true) виден', () => {
    const res = runnableScenarios(scenarios);
    expect(res.map((s) => s.name)).toContain('create');
  });

  it('destroy (runnable=false) скрыт', () => {
    const res = runnableScenarios(scenarios);
    expect(res.map((s) => s.name)).not.toContain('destroy');
  });

  it('converge (runnable=true) виден', () => {
    const res = runnableScenarios(scenarios);
    expect(res.map((s) => s.name)).toContain('converge');
  });

  it('operational (runnable=true) виден', () => {
    const res = runnableScenarios(scenarios);
    expect(res.map((s) => s.name)).toContain('restart');
  });

  it('итог: только 3 (create, converge, restart)', () => {
    const res = runnableScenarios(scenarios);
    expect(res).toHaveLength(3);
  });

  it('fallback: если runnable отсутствует — lifecycle скрыт, operational виден (обратная совместимость)', () => {
    // Old backend doesn't return runnable -- simulate a missing field.
    const legacy = [
      { name: 'create',  kind: 'lifecycle' as const, path: '' },
      { name: 'restart', kind: 'operational' as const, path: '' },
    ];
    const res = runnableScenarios(legacy);
    // legacy-mode fallback: lifecycle hidden (runnable undefined -> !isLifecycle=false -> false)
    expect(res.map((s) => s.name)).not.toContain('create');
    expect(res.map((s) => s.name)).toContain('restart');
  });
});

// ────────────────────────────────────────────────────────────
// 2. "Rerun last failed" button -- visibility by status
// ────────────────────────────────────────────────────────────
describe('IncarnationDetail — кнопка rerunLast', () => {
  function renderDetail(status: string) {
    mockFetch(makeIncarnation(status));
    return renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/test-inc',
    );
  }

  it('видна при status=error_locked', async () => {
    tokenStore.clear();
    renderDetail('error_locked');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'test-inc' })).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: /перезапустить последний упавший/i }),
    ).toBeInTheDocument();
  });

  it('НЕ видна при status=ready', async () => {
    tokenStore.clear();
    renderDetail('ready');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'test-inc' })).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: /перезапустить последний упавший/i }),
    ).not.toBeInTheDocument();
  });

  it('НЕ видна при status=migration_failed (только Unlock)', async () => {
    tokenStore.clear();
    renderDetail('migration_failed');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'test-inc' })).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: /перезапустить последний упавший/i }),
    ).not.toBeInTheDocument();
    // Unlock button is present regardless (isLocked=true).
    expect(screen.getByRole('button', { name: /unlock/i })).toBeInTheDocument();
  });
});

// ────────────────────────────────────────────────────────────
// 3. Modal requires reason
// ────────────────────────────────────────────────────────────
describe('RerunLastModal — валидация reason', () => {
  it('не отправляет запрос при пустом reason', async () => {
    tokenStore.clear();
    let postCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (method === 'POST' && urlStr.includes('rerun-last')) {
        postCount++;
      }
      return new Response(JSON.stringify(makeIncarnation('error_locked')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/test-inc',
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'test-inc' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /перезапустить последний упавший/i }));

    // Modal opened -- title is present.
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Click confirm without filling reason (button inside dialog -- last of the matches).
    const dialog = screen.getByRole('dialog');
    const btns = within(dialog).getAllByRole('button', { name: /перезапустить последний упавший/i });
    await user.click(btns[0]);

    // POST was not sent.
    expect(postCount).toBe(0);
    // Validation message (minimum 5 characters).
    await waitFor(() => {
      expect(screen.getByText(/минимум 5 символов/i)).toBeInTheDocument();
    });
  });
});

// ────────────────────────────────────────────────────────────
// 4. Happy-path: POST with reason -> 202 (incl. scenario) -> toast with scenario name
// ────────────────────────────────────────────────────────────
describe('RerunLastModal — happy-path', () => {
  it('POST уходит с {reason}, 202 → тост с именем сценария и apply_id', async () => {
    tokenStore.clear();
    let capturedBody: unknown = null;
    let postUrl = '';

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'POST' && urlStr.includes('rerun-last')) {
        capturedBody = init?.body ? JSON.parse(init.body as string) : null;
        postUrl = urlStr;
        return new Response(
          JSON.stringify({
            apply_id: '01HWTEST000000000000000001',
            incarnation: 'test-inc',
            scenario: 'add_user',
          }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(makeIncarnation('error_locked')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/test-inc',
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'test-inc' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /перезапустить последний упавший/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'исправлен конфиг вручную');

    await user.click(screen.getAllByRole('button', { name: /перезапустить последний упавший/i }).find(
      (b) => !b.hasAttribute('title'), // button inside the modal, without a title tooltip
    ) ?? screen.getAllByRole('button', { name: /перезапустить последний упавший/i })[0]);

    // POST was sent to the correct URL.
    await waitFor(() => {
      expect(postUrl).toMatch(/\/v1\/incarnations\/test-inc\/rerun-last/);
    });
    expect(capturedBody).toEqual({ reason: 'исправлен конфиг вручную' });

    // Toast with the scenario name and apply_id appeared.
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
    const toastText = screen.getByRole('status').textContent ?? '';
    expect(toastText).toContain('add_user');
    expect(toastText).toContain('01HWTEST000000000000000001');
  });
});

// ────────────────────────────────────────────────────────────
// 4b. reasonMax: >500 characters -- client-side error, POST is not sent
// ────────────────────────────────────────────────────────────
describe('RerunLastModal — reasonMax 500 символов', () => {
  it('reason длиннее 500 символов — показывает ошибку, POST не уходит', async () => {
    tokenStore.clear();
    let postCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (method === 'POST' && urlStr.includes('rerun-last')) postCount++;
      return new Response(JSON.stringify(makeIncarnation('error_locked')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/test-inc',
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'test-inc' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /перезапустить последний упавший/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Enter a string longer than 500 characters (501 'a').
    // fireEvent.change is used deliberately: jsdom doesn't enforce the HTML maxLength attribute,
    // so only a direct value change lets us test the Zod validation.
    const textarea = screen.getByRole('textbox');
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(textarea, { target: { value: 'a'.repeat(501) } });

    const dialog = screen.getByRole('dialog');
    const btns = within(dialog).getAllByRole('button', { name: /перезапустить последний упавший/i });
    await user.click(btns[0]);

    // POST was not sent
    expect(postCount).toBe(0);
    // Client-side error message shown
    await waitFor(() => {
      expect(screen.getByText(/максимум 500 символов/i)).toBeInTheDocument();
    });
  });
});

// ────────────────────────────────────────────────────────────
// 5. 409 -- two different conflict cases
// ────────────────────────────────────────────────────────────
describe('RerunLastModal — 409 conflict', () => {
  async function submit409(type: string, detail: string) {
    tokenStore.clear();

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'POST' && urlStr.includes('rerun-last')) {
        return new Response(
          JSON.stringify({ type, title: 'Conflict', detail }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(makeIncarnation('error_locked')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/test-inc',
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'test-inc' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /перезапустить последний упавший/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog');
    const textarea = within(dialog).getByRole('textbox');
    await user.type(textarea, 'причина тестового 409');

    const btns = within(dialog).getAllByRole('button', { name: /перезапустить последний упавший/i });
    await user.click(btns[0]);
  }

  it('type=incarnation-locked (не-error_locked) — показывает generic conflict-сообщение', async () => {
    await submit409(
      'https://soul-stack.io/errors/incarnation-locked',
      'incarnation test-inc is not error_locked — rerun-last requires error_locked',
    );

    await waitFor(() => {
      expect(
        screen.getByText(/инкарнация не в статусе error_locked/i),
      ).toBeInTheDocument();
    });
  });

  it('type=rerun-input-unavailable — показывает сообщение про unlock + ручной запуск', async () => {
    await submit409(
      'https://soul-stack.io/errors/rerun-input-unavailable',
      'incarnation test-inc rerun-last неприменим: input упавшего прогона недоступен ' +
      '(рецепт вычищен ретеншном либо legacy-прогон без рецепта) — сними блок обычным unlock ' +
      'и запусти нужный сценарий вручную с явным input',
    );

    await waitFor(() => {
      expect(
        screen.getByText(/снимите блок обычным unlock и запустите сценарий вручную/i),
      ).toBeInTheDocument();
    });
  });
});
