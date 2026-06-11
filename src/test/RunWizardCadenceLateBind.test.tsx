/**
 * Guard-тесты: late-binding баг Command+Cadence.
 *
 * Ключевые инварианты:
 *   1. Command+Cadence с coven → POST /v1/cadences body.target.coven == [covens],
 *      body.target.sids ОТСУТСТВУЕТ (не snapshot).
 *   2. Command+Voyage (разовый) → body.target.sids == resolvedSids, НЕ coven.
 *   3. Cadence с regex/soulprint И coven → плашка cadence-early-binding-warn видна.
 *   4. Cadence с только regex (без coven) → плашка cadence-snapshot-only-warn видна.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { RunWizard } from '../pages/run/RunWizard';
import { tokenStore } from '../api/tokenStore';

function renderWizard(initialPath = '/run') {
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
      <Route path="/run" element={<RunWizard />} />
      <Route path="/cadences/:id" element={<div data-testid="cadence-detail" />} />
      <Route path="/voyages/:id" element={<div data-testid="voyage-detail" />} />
    </Routes>,
    { wrapper: Wrap },
  );
}

interface PostCapture {
  url: string;
  body: unknown;
}

function setupFetch(
  souls: Array<{ sid: string; covens?: string[] }> = [],
): { posts: PostCapture[] } {
  const posts: PostCapture[] = [];

  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : null;
      const json = (obj: unknown, status = 200) =>
        new Response(JSON.stringify(obj), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });

      if (method === 'POST' && url.includes('/v1/cadences')) {
        posts.push({ url, body });
        return json(
          { cadence_id: 'cad-lb-01', name: 'test', enabled: true, location: '/v1/cadences/cad-lb-01' },
          201,
        );
      }
      if (method === 'POST' && url.includes('/v1/voyages')) {
        posts.push({ url, body });
        return json(
          { voyage_id: 'voy-lb-01', kind: 'command', scope_size: 1, status: 'pending', location: '' },
          202,
        );
      }

      if (url.includes('/v1/souls')) {
        return json({
          items: souls.map((s) => ({
            sid: s.sid,
            transport: 'agent',
            status: 'connected',
            covens: s.covens ?? [],
            registered_at: '',
          })),
          offset: 0,
          limit: 1000,
          total: souls.length,
        });
      }
      if (url.includes('/v1/modules')) {
        return json({
          items: [
            {
              name: 'core.cmd',
              kind: 'core',
              states: ['shell'],
              errand_safe: true,
              params: [{ name: 'cmd', type: 'string', required: true, multiline: true }],
            },
          ],
        });
      }
      if (url.includes('/v1/services')) {
        return json({ items: [], offset: 0, limit: 50, total: 0 });
      }
      if (url.includes('/v1/incarnations')) {
        return json({ items: [], offset: 0, limit: 500, total: 0 });
      }
      return new Response('{}', { status: 404 });
    },
  );

  return { posts };
}

/** Навигация: Step1 Command → выбрать coven → Step3 → Step4 + cadence-fields */
async function navigateToStep4CommandCadence(user: ReturnType<typeof userEvent.setup>) {
  // Step 1: выбрать Command + режим «Регулярно»
  await user.click(screen.getByLabelText('Command'));
  await user.click(screen.getByLabelText('Регулярно'));
  await user.click(screen.getByRole('button', { name: /Далее/ }));

  // Step 2: ввести coven. ChipsInput: aria-label на div-контейнере, input — вложен.
  const covenChip = await screen.findByLabelText('Coven labels');
  const covenInputEl = covenChip.querySelector('input') as HTMLInputElement;
  await user.type(covenInputEl, 'web-prod ');

  // Ждём резолва хостов (query async), иначе кнопка Далее disabled.
  // "1 hosts match" / "2 hosts match" etc.
  await waitFor(() =>
    expect(screen.getByLabelText('Host preview').textContent).toMatch(/\d+ hosts match/),
  );

  // Кнопка Далее должна стать enabled после резолва
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Далее/ })).not.toBeDisabled(),
  );

  // Перейти на Step 3
  await user.click(screen.getByRole('button', { name: /Далее/ }));

  // Step 3: дождаться module-поля, заполнить cmd
  await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
  await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');

  // Перейти на Step 4
  await user.click(screen.getByRole('button', { name: /Далее/ }));
  await waitFor(() => expect(screen.getByTestId('cadence-name')).toBeInTheDocument());
}

beforeEach(() => {
  tokenStore.set('tok-test');
  sessionStorage.clear();
  // @ts-expect-error EventSource не в jsdom
  globalThis.EventSource = class {
    readyState = 0;
    close() {}
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSED = 2;
  };
});

afterEach(() => {
  // Сброс vi.stubGlobal — гарантирует, что fetch-стаб текущего теста
  // не "протекает" в следующий тест (незавершённые async-запросы React Query).
  vi.unstubAllGlobals();
});

describe('Command+Cadence late-binding guard', () => {
  it('Cadence с coven → POST /v1/cadences body.target.coven == ["web-prod"], НЕ sids', async () => {
    const { posts } = setupFetch([{ sid: 'host-01.example.com', covens: ['web-prod'] }]);
    renderWizard();
    const user = userEvent.setup();

    await navigateToStep4CommandCadence(user);

    await user.clear(screen.getByTestId('cadence-name'));
    await user.type(screen.getByTestId('cadence-name'), 'web-hourly');
    await user.click(screen.getByRole('button', { name: /Создать расписание/ }));
    await waitFor(() => expect(screen.getByTestId('cadence-detail')).toBeInTheDocument());

    const cadPosts = posts.filter((p) => (p.url as string).includes('/v1/cadences'));
    expect(cadPosts).toHaveLength(1);

    const body = cadPosts[0].body as Record<string, unknown>;
    const target = body.target as Record<string, unknown> | undefined;
    expect(target).toBeDefined();

    // Главный регресс-guard: если кто-то вернёт resolvedSids — этот assert упадёт.
    expect(target!.sids).toBeUndefined();
    expect(target!.coven).toEqual(['web-prod']);
  });

  it('Command Voyage (разовый) с coven → body.target.sids == resolvedSids (snapshot сохранён)', async () => {
    const { posts } = setupFetch([{ sid: 'host-01.example.com', covens: ['web-prod'] }]);
    renderWizard();
    const user = userEvent.setup();

    // Step 1: Command + режим «Разово» (дефолт)
    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByRole('button', { name: /Далее/ }));

    // Step 2: ввести coven
    const covenChip = await screen.findByLabelText('Coven labels');
    const covenInputEl = covenChip.querySelector('input') as HTMLInputElement;
    await user.type(covenInputEl, 'web-prod ');

    // Ждём резолва хостов
    await waitFor(() =>
      expect(screen.getByLabelText('Host preview').textContent).toMatch(/\d+ hosts match/),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Далее/ })).not.toBeDisabled(),
    );

    // Перейти на Step 3
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByTestId('field-multiline-cmd')).toBeInTheDocument());
    await user.type(screen.getByTestId('field-multiline-cmd'), 'uptime');

    // Step 4
    await user.click(screen.getByRole('button', { name: /Далее/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Запустить/ })).not.toBeDisabled());

    await user.click(screen.getByRole('button', { name: /Запустить/ }));
    await waitFor(() => expect(screen.getByTestId('voyage-detail')).toBeInTheDocument());

    const voyPosts = posts.filter((p) => (p.url as string).includes('/v1/voyages'));
    expect(voyPosts).toHaveLength(1);

    const body = voyPosts[0].body as Record<string, unknown>;
    const target = body.target as Record<string, unknown> | undefined;
    expect(target).toBeDefined();

    // Разовый Voyage должен шлёт snapshot sids, NOT coven.
    expect(target!.sids).toEqual(['host-01.example.com']);
    expect(target!.coven).toBeUndefined();
  });

  it('Cadence + coven + sidRegex → плашка cadence-early-binding-warn видна', async () => {
    setupFetch([{ sid: 'host-01.example.com', covens: ['web-prod'] }]);
    renderWizard();
    const user = userEvent.setup();

    // Step 1: Command + Регулярно
    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByLabelText('Регулярно'));
    await user.click(screen.getByRole('button', { name: /Далее/ }));

    // Step 2: ввести coven + sidRegex
    const covenChip = await screen.findByLabelText('Coven labels');
    const covenInputEl = covenChip.querySelector('input') as HTMLInputElement;
    await user.type(covenInputEl, 'web-prod ');
    await user.type(screen.getByLabelText('SID regex'), 'host-.*');

    // Плашка earlyBinding должна появиться
    await waitFor(() =>
      expect(screen.getByTestId('cadence-early-binding-warn')).toBeInTheDocument(),
    );
    // Плашка snapshotOnly НЕ должна появляться (coven задан)
    expect(screen.queryByTestId('cadence-snapshot-only-warn')).not.toBeInTheDocument();
  });

  it('Cadence + только sidRegex (без coven) → плашка cadence-snapshot-only-warn видна', async () => {
    setupFetch([{ sid: 'host-01.example.com', covens: ['web-prod'] }]);
    renderWizard();
    const user = userEvent.setup();

    // Step 1: Command + Регулярно
    await user.click(screen.getByLabelText('Command'));
    await user.click(screen.getByLabelText('Регулярно'));
    await user.click(screen.getByRole('button', { name: /Далее/ }));

    // Step 2: только sidRegex, без coven
    await waitFor(() => screen.getByLabelText('SID regex'));
    await user.type(screen.getByLabelText('SID regex'), 'host-.*');

    // Плашка snapshotOnly должна появиться
    await waitFor(() =>
      expect(screen.getByTestId('cadence-snapshot-only-warn')).toBeInTheDocument(),
    );
    // Плашка earlyBinding НЕ должна появляться (нет coven)
    expect(screen.queryByTestId('cadence-early-binding-warn')).not.toBeInTheDocument();
  });
});
