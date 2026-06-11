import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { IncarnationDetail } from '../pages/incarnations/IncarnationDetail';
import { ChoirsTab } from '../pages/incarnations/ChoirsTab';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

// Базовый incarnation fixture.
const INCARNATION = {
  name: 'redis-prod',
  service: 'redis',
  service_version: 'v2.0.0',
  state_schema_version: 3,
  covens: ['prod'],
  spec: { hosts: [{ sid: 'host-a.local', role: 'master' }] },
  state: {},
  status: 'ready',
  created_by_aid: 'archon-alice',
  created_at: '2026-05-20T10:00:00Z',
  updated_at: '2026-05-25T12:00:00Z',
};

const SOULS = {
  items: [
    { sid: 'host-a.local', transport: 'agent', status: 'connected', registered_at: '2026-05-27T00:00:00Z' },
    { sid: 'host-b.local', transport: 'agent', status: 'connected', registered_at: '2026-05-27T00:00:00Z' },
  ],
  offset: 0,
  limit: 200,
  total: 2,
};

const CHOIRS_EMPTY = { items: [], offset: 0, limit: 100, total: 0 };

const CHOIRS_ONE = {
  items: [
    {
      incarnation_name: 'redis-prod',
      choir_name: 'primaries',
      description: 'Primary nodes',
      min_size: 1,
      max_size: 3,
      created_at: '2026-05-29T10:00:00Z',
      created_by_aid: 'archon-alice',
    },
  ],
  offset: 0,
  limit: 100,
  total: 1,
};

const VOICES_EMPTY = { items: [], offset: 0, limit: 100, total: 0 };

const VOICES_ONE = {
  items: [
    {
      incarnation_name: 'redis-prod',
      choir_name: 'primaries',
      sid: 'host-a.local',
      role: 'master',
      position: 0,
      added_at: '2026-05-29T11:00:00Z',
      added_by_aid: 'archon-alice',
    },
  ],
  offset: 0,
  limit: 100,
  total: 1,
};

describe('ChoirsTab', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  // --- рендер вкладки через IncarnationDetail ---

  it('рендерит вкладку Choirs, переход открывает секцию', async () => {
    // Более специфичные URL-ы идут первыми (installFetchMock использует startsWith).
    installFetchMock([
      { method: 'GET', url: '/v1/incarnations/redis-prod/choirs', body: CHOIRS_EMPTY },
      { method: 'GET', url: '/v1/incarnations/redis-prod', body: INCARNATION },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/redis-prod',
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'redis-prod' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Choirs/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Choirs/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/Choir-ов нет/i)).toBeInTheDocument();
  });

  // --- создание Choir ---

  it('Create Choir — модалка открывается, POST уходит при submit', async () => {
    let postCount = 0;
    let lastBody: unknown = null;

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'POST' && url.includes('/choirs') && !url.includes('/voices')) {
        postCount += 1;
        lastBody = init?.body ? JSON.parse(init.body as string) : null;
        return new Response(
          JSON.stringify({
            incarnation_name: 'redis-prod',
            choir_name: 'primaries',
            description: null,
            min_size: null,
            max_size: null,
            created_at: '2026-05-29T10:00:00Z',
            created_by_aid: 'archon-alice',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/choirs')) {
        return new Response(JSON.stringify(CHOIRS_EMPTY), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(INCARNATION), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/redis-prod',
    );

    await waitFor(() => screen.getByRole('heading', { name: 'redis-prod' }));

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Choirs/i }));
    await waitFor(() => screen.getByRole('heading', { name: /Choirs/i }));

    // Открываем модалку создания (aria-label — кнопка, не empty-hint).
    const createBtn = screen.getAllByRole('button').find((b) => /Создать Choir/.test(b.textContent ?? ''))!;
    await user.click(createBtn);

    // Заполняем имя.
    const nameInput = screen.getByTestId('choir-name-input');
    await user.type(nameInput, 'primaries');

    // Submit.
    await user.click(screen.getByTestId('create-choir-submit'));

    await waitFor(() => {
      expect(postCount).toBe(1);
    });
    expect(lastBody).toMatchObject({ choir_name: 'primaries' });
  });

  // --- валидация имени choir ---

  it('choir_name с невалидным паттерном → form-error, POST не уходит', async () => {
    let postCount = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST') postCount += 1;
      if (url.includes('/choirs')) {
        return new Response(JSON.stringify(CHOIRS_EMPTY), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(INCARNATION), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/redis-prod',
    );

    await waitFor(() => screen.getByRole('heading', { name: 'redis-prod' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Choirs/i }));
    await waitFor(() => screen.getByRole('heading', { name: /Choirs/i }));

    const createBtn2 = screen.getAllByRole('button').find((b) => /Создать Choir/.test(b.textContent ?? ''))!;
    await user.click(createBtn2);

    const nameInput = screen.getByTestId('choir-name-input');
    await user.type(nameInput, 'INVALID NAME!');
    await user.click(screen.getByTestId('create-choir-submit'));

    await waitFor(() => {
      expect(screen.getByText(/Название должно соответствовать/)).toBeInTheDocument();
    });
    expect(postCount).toBe(0);
  });

  // --- удаление Choir ---

  it('Delete Choir — confirm-модалка, DELETE уходит только после подтверждения чекбоксом', async () => {
    let deleteCount = 0;

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'DELETE' && url.includes('/choirs/primaries')) {
        deleteCount += 1;
        return new Response('', { status: 204 });
      }
      if (url.includes('/choirs')) {
        return new Response(JSON.stringify(CHOIRS_ONE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(INCARNATION), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/redis-prod',
    );

    await waitFor(() => screen.getByRole('heading', { name: 'redis-prod' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Choirs/i }));

    await waitFor(() => {
      expect(screen.getByTestId('delete-choir-primaries')).toBeInTheDocument();
    });

    // Кликаем на удаление.
    await user.click(screen.getByTestId('delete-choir-primaries'));

    // Модалка открылась. DELETE ещё не уходил.
    const confirmBtn = screen.getByTestId('delete-choir-confirm');
    expect(confirmBtn).toBeDisabled();
    expect(deleteCount).toBe(0);

    // Чекбокс → confirm.
    await user.click(screen.getByTestId('delete-choir-checkbox'));
    expect(confirmBtn).not.toBeDisabled();
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(deleteCount).toBe(1);
    });
  });

  // --- добавление Voice ---

  it('Add Voice → POST уходит с sid/role/position', async () => {
    let voicePostCount = 0;
    let lastVoiceBody: unknown = null;

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'POST' && url.includes('/voices')) {
        voicePostCount += 1;
        lastVoiceBody = init?.body ? JSON.parse(init.body as string) : null;
        return new Response(
          JSON.stringify({
            incarnation_name: 'redis-prod',
            choir_name: 'primaries',
            sid: 'host-a.local',
            role: 'master',
            position: 0,
            added_at: '2026-05-29T11:00:00Z',
            added_by_aid: 'archon-alice',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/voices')) {
        return new Response(JSON.stringify(VOICES_EMPTY), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/choirs')) {
        return new Response(JSON.stringify(CHOIRS_ONE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/v1/souls')) {
        return new Response(JSON.stringify(SOULS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(INCARNATION), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/redis-prod',
    );

    await waitFor(() => screen.getByRole('heading', { name: 'redis-prod' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Choirs/i }));

    // Раскрываем choir.
    await waitFor(() => screen.getByTestId('choir-toggle-primaries'));
    await user.click(screen.getByTestId('choir-toggle-primaries'));

    // Кнопка «Добавить Voice».
    await waitFor(() => screen.getByText(/Добавить Voice/i));
    await user.click(screen.getByText(/Добавить Voice/i));

    // Выбираем SID.
    await waitFor(() => screen.getByTestId('voice-sid-select'));
    await user.selectOptions(screen.getByTestId('voice-sid-select'), 'host-a.local');

    // Role.
    await user.type(screen.getByTestId('voice-role-input'), 'master');

    // Position.
    await user.type(screen.getByTestId('voice-position-input'), '0');

    await user.click(screen.getByTestId('add-voice-submit'));

    await waitFor(() => {
      expect(voicePostCount).toBe(1);
    });
    expect(lastVoiceBody).toMatchObject({ sid: 'host-a.local', role: 'master', position: 0 });
  });

  // --- 422 ErrNotMembers ---

  it('422 ErrNotMembers при add voice → человекочитаемое сообщение', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'POST' && url.includes('/voices')) {
        return new Response(
          JSON.stringify({ title: 'Unprocessable', detail: 'not a member' }),
          { status: 422, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/voices')) {
        return new Response(JSON.stringify(VOICES_EMPTY), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/choirs')) {
        return new Response(JSON.stringify(CHOIRS_ONE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/v1/souls')) {
        return new Response(JSON.stringify(SOULS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(INCARNATION), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/redis-prod',
    );

    await waitFor(() => screen.getByRole('heading', { name: 'redis-prod' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Choirs/i }));

    await waitFor(() => screen.getByTestId('choir-toggle-primaries'));
    await user.click(screen.getByTestId('choir-toggle-primaries'));

    await waitFor(() => screen.getByText(/Добавить Voice/i));
    await user.click(screen.getByText(/Добавить Voice/i));

    await waitFor(() => screen.getByTestId('voice-sid-select'));
    await user.selectOptions(screen.getByTestId('voice-sid-select'), 'host-a.local');
    await user.click(screen.getByTestId('add-voice-submit'));

    await waitFor(() => {
      // Новый текст: coven=<incarnationName>, ссылка на реестр Souls.
      expect(screen.getByText(/coven=redis-prod/i)).toBeInTheDocument();
      expect(screen.getByText(/Souls/i)).toBeInTheDocument();
    });
  });

  // --- удаление Voice ---

  it('Remove Voice — кнопка Trash2 отправляет DELETE', async () => {
    let deleteVoiceCount = 0;

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'DELETE' && url.includes('/voices/host-a.local')) {
        deleteVoiceCount += 1;
        return new Response('', { status: 204 });
      }
      if (url.includes('/voices')) {
        return new Response(JSON.stringify(VOICES_ONE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/choirs')) {
        return new Response(JSON.stringify(CHOIRS_ONE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(INCARNATION), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/redis-prod',
    );

    await waitFor(() => screen.getByRole('heading', { name: 'redis-prod' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Choirs/i }));

    await waitFor(() => screen.getByTestId('choir-toggle-primaries'));
    await user.click(screen.getByTestId('choir-toggle-primaries'));

    // Ждём появления Voice-ов в таблице.
    await waitFor(() => {
      expect(screen.getByText('host-a.local')).toBeInTheDocument();
    });

    // Кликаем Trash2 для удаления Voice.
    await user.click(screen.getByTestId('remove-voice-host-a.local'));

    await waitFor(() => {
      expect(deleteVoiceCount).toBe(1);
    });
  });

  // --- прямой рендер ChoirsTab (graceful empty-state) ---

  it('ChoirsTab — graceful empty-state без краша при пустых данных', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/incarnations/x/choirs', body: CHOIRS_EMPTY },
    ]);
    renderWithProviders(
      <ChoirsTab incarnationName="x" />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Choir-ов нет/i)).toBeInTheDocument();
    });
  });

  // --- Choir list с описанием и min/max ---

  it('Choir с description/min_size/max_size рендерится без краша', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/incarnations/redis-prod/choirs', body: CHOIRS_ONE },
    ]);
    renderWithProviders(<ChoirsTab incarnationName="redis-prod" />);

    await waitFor(() => {
      expect(screen.getByText('primaries')).toBeInTheDocument();
    });
    expect(screen.getByText('Primary nodes')).toBeInTheDocument();
    // min/max отображается.
    expect(screen.getByText(/1…3/)).toBeInTheDocument();
  });

  // --- graceful-404: choir-подсистема недоступна ---

  it('choirs.list 404 → graceful-плейсхолдер, не error-box', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url.includes('/choirs')) {
        return new Response(JSON.stringify({ title: 'Not Found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(INCARNATION), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(<ChoirsTab incarnationName="redis-prod" />);

    await waitFor(() => {
      expect(screen.getByTestId('choirs-degraded')).toBeInTheDocument();
    });
    // Не должно быть красного error-box с choirsLoadFailed.
    expect(screen.queryByText(/Не удалось загрузить Choir/i)).not.toBeInTheDocument();
  });

  // --- confirm-модалка DeleteChoir ---

  it('DeleteChoirModal: кнопка Delete заблокирована без подтверждения чекбокса', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/incarnations/redis-prod/choirs', body: CHOIRS_ONE },
    ]);
    renderWithProviders(<ChoirsTab incarnationName="redis-prod" />);

    await waitFor(() => screen.getByTestId('delete-choir-primaries'));
    const user = userEvent.setup();
    await user.click(screen.getByTestId('delete-choir-primaries'));

    const confirmBtn = screen.getByTestId('delete-choir-confirm');
    expect(confirmBtn).toBeDisabled();

    // После чекбокса — enabled.
    await user.click(screen.getByTestId('delete-choir-checkbox'));
    expect(confirmBtn).not.toBeDisabled();
  });
});
