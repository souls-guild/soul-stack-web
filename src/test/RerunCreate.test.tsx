/**
 * Тесты для lifecycle-rework S5:
 * 1. runnableScenarios фильтрует по полю `runnable` (create виден, destroy нет, converge виден)
 * 2. Кнопка «Перезапустить create» видна только на error_locked
 * 3. Модалка требует reason (пустой = ошибка валидации)
 * 4. Happy-path: вызов с правильным телом → 202 + apply_id → тост
 * 5. Обработка 409: показывает пояснительное сообщение
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

// Фикстура инкарнации с заданным статусом.
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

// Fetch-мок для incarnation-get.
function mockFetch(incBody: unknown, overrides?: Record<string, { status: number; body: unknown }>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
  }) as typeof fetch;
}

// ────────────────────────────────────────────────────────────
// 1. Фильтрация runnableScenarios по полю runnable
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
    // Старый backend не отдаёт runnable — имитируем отсутствие поля.
    const legacy = [
      { name: 'create',  kind: 'lifecycle' as const, path: '' },
      { name: 'restart', kind: 'operational' as const, path: '' },
    ];
    const res = runnableScenarios(legacy);
    // legacy-режим fallback: lifecycle скрыт (runnable undefined → !isLifecycle=false → false)
    expect(res.map((s) => s.name)).not.toContain('create');
    expect(res.map((s) => s.name)).toContain('restart');
  });
});

// ────────────────────────────────────────────────────────────
// 2. Кнопка «Перезапустить create» — видимость по статусу
// ────────────────────────────────────────────────────────────
describe('IncarnationDetail — кнопка rerunCreate', () => {
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
      screen.getByRole('button', { name: /перезапустить create/i }),
    ).toBeInTheDocument();
  });

  it('НЕ видна при status=ready', async () => {
    tokenStore.clear();
    renderDetail('ready');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'test-inc' })).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: /перезапустить create/i }),
    ).not.toBeInTheDocument();
  });

  it('НЕ видна при status=migration_failed (только Unlock)', async () => {
    tokenStore.clear();
    renderDetail('migration_failed');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'test-inc' })).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: /перезапустить create/i }),
    ).not.toBeInTheDocument();
    // Unlock-кнопка при этом есть (isLocked=true).
    expect(screen.getByRole('button', { name: /unlock/i })).toBeInTheDocument();
  });
});

// ────────────────────────────────────────────────────────────
// 3. Модалка требует reason
// ────────────────────────────────────────────────────────────
describe('RerunCreateModal — валидация reason', () => {
  it('не отправляет запрос при пустом reason', async () => {
    tokenStore.clear();
    let postCount = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (method === 'POST' && urlStr.includes('rerun-create')) {
        postCount++;
      }
      return new Response(JSON.stringify(makeIncarnation('error_locked')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

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
    await user.click(screen.getByRole('button', { name: /перезапустить create/i }));

    // Модалка открылась — заголовок есть.
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Кликаем confirm без заполнения reason (кнопка внутри dialog — последняя из совпавших).
    const dialog = screen.getByRole('dialog');
    const btns = within(dialog).getAllByRole('button', { name: /перезапустить create/i });
    await user.click(btns[0]);

    // POST не ушёл.
    expect(postCount).toBe(0);
    // Валидационное сообщение (минимум 5 символов).
    await waitFor(() => {
      expect(screen.getByText(/минимум 5 символов/i)).toBeInTheDocument();
    });
  });
});

// ────────────────────────────────────────────────────────────
// 4. Happy-path: POST с reason → 202 + тост с apply_id
// ────────────────────────────────────────────────────────────
describe('RerunCreateModal — happy-path', () => {
  it('POST уходит с {reason}, 202 → тост с apply_id', async () => {
    tokenStore.clear();
    let capturedBody: unknown = null;
    let postUrl = '';

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'POST' && urlStr.includes('rerun-create')) {
        capturedBody = init?.body ? JSON.parse(init.body as string) : null;
        postUrl = urlStr;
        return new Response(
          JSON.stringify({ apply_id: '01HWTEST000000000000000001', incarnation: 'test-inc' }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(makeIncarnation('error_locked')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

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
    await user.click(screen.getByRole('button', { name: /перезапустить create/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'исправлен конфиг вручную');

    await user.click(screen.getAllByRole('button', { name: /перезапустить create/i }).find(
      (b) => !b.hasAttribute('title'), // кнопка внутри модалки, без title-тултипа
    ) ?? screen.getAllByRole('button', { name: /перезапустить create/i })[0]);

    // POST ушёл по правильному URL.
    await waitFor(() => {
      expect(postUrl).toMatch(/\/v1\/incarnations\/test-inc\/rerun-create/);
    });
    expect(capturedBody).toEqual({ reason: 'исправлен конфиг вручную' });

    // Тост с apply_id появился.
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
    expect(screen.getByRole('status').textContent).toContain('01HWTEST000000000000000001');
  });
});

// ────────────────────────────────────────────────────────────
// 5. 409 — показывает пояснительный текст
// ────────────────────────────────────────────────────────────
describe('RerunCreateModal — 409 conflict', () => {
  it('показывает сообщение о том, что последний прогон не create', async () => {
    tokenStore.clear();

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'POST' && urlStr.includes('rerun-create')) {
        return new Response(
          JSON.stringify({ type: 'about:blank', title: 'Conflict', detail: 'last run is not create' }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(makeIncarnation('error_locked')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

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
    await user.click(screen.getByRole('button', { name: /перезапустить create/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog');
    const textarea = within(dialog).getByRole('textbox');
    await user.type(textarea, 'причина тестового 409');

    // Кнопка submit внутри модалки.
    const btns = within(dialog).getAllByRole('button', { name: /перезапустить create/i });
    await user.click(btns[0]);

    // Сообщение об ошибке 409 появилось.
    await waitFor(() => {
      expect(
        screen.getByText(/последний упавший прогон не является сценарием create/i),
      ).toBeInTheDocument();
    });
  });
});
