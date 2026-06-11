import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { CreateSoulModal } from '../pages/souls/CreateSoulModal';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

describe('CreateSoulModal', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  it('рендерит форму с полями SID / transport / covens', async () => {
    installFetchMock([]);
    renderWithProviders(<CreateSoulModal open onClose={() => {}} />);

    expect(screen.getByLabelText('SID нового хоста')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument(); // transport select
    expect(screen.getByLabelText('coven-метки')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Зарегистрировать/i })).toBeInTheDocument();
  });

  it('кнопка Register заблокирована при пустом SID', async () => {
    installFetchMock([]);
    renderWithProviders(<CreateSoulModal open onClose={() => {}} />);

    const btn = screen.getByRole('button', { name: /Зарегистрировать/i });
    expect(btn).toBeDisabled();
  });

  it('невалидный SID показывает ошибку и блокирует кнопку', async () => {
    installFetchMock([]);
    const user = userEvent.setup();
    renderWithProviders(<CreateSoulModal open onClose={() => {}} />);

    const sidInput = screen.getByLabelText('SID нового хоста');
    await user.type(sidInput, 'INVALID_SID!');

    await waitFor(() => {
      expect(screen.getByText(/Невалидный SID/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Зарегистрировать/i })).toBeDisabled();
  });

  it('transport=agent — submit → POST /v1/souls → success с bootstrap_token', async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/souls',
        body: { items: [], offset: 0, limit: 200, total: 0 },
      },
      {
        method: 'POST',
        url: '/v1/souls',
        status: 201,
        body: {
          sid: 'host01.example.com',
          transport: 'agent',
          status: 'pending',
          registered_at: '2026-05-29T10:00:00Z',
          created_by_aid: 'archon-bootstrap',
          bootstrap_token: 'btoken-super-secret-abc123',
          expires_at: '2026-05-30T10:00:00Z',
        },
      },
    ]);

    // Перехватываем fetch для проверки body
    const baseFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (init?.body) {
        try { calls.push({ method, url, body: JSON.parse(init.body as string) }); } catch { /* empty */ }
      }
      return baseFetch(input, init);
    });

    const user = userEvent.setup();
    renderWithProviders(<CreateSoulModal open onClose={() => {}} />);

    const sidInput = screen.getByLabelText('SID нового хоста');
    await user.type(sidInput, 'host01.example.com');

    const registerBtn = screen.getByRole('button', { name: /Зарегистрировать/i });
    await waitFor(() => expect(registerBtn).not.toBeDisabled());
    await user.click(registerBtn);

    // success-state показывает токен и warning
    await waitFor(() => {
      expect(screen.getByText('btoken-super-secret-abc123')).toBeInTheDocument();
    });
    expect(screen.getByText(/Токен отображается ОДИН РАЗ/i)).toBeInTheDocument();
  });

  it('transport=ssh — success без bootstrap_token, показывает SSH-сообщение', async () => {
    installFetchMock([
      {
        method: 'POST',
        url: '/v1/souls',
        status: 201,
        body: {
          sid: 'host02.example.com',
          transport: 'ssh',
          status: 'pending',
          registered_at: '2026-05-29T10:00:00Z',
          created_by_aid: 'archon-bootstrap',
        },
      },
    ]);

    const user = userEvent.setup();
    renderWithProviders(<CreateSoulModal open onClose={() => {}} />);

    const sidInput = screen.getByLabelText('SID нового хоста');
    await user.type(sidInput, 'host02.example.com');

    // переключаем transport на ssh
    const transportSelect = screen.getByRole('combobox');
    await user.selectOptions(transportSelect, 'ssh');

    const registerBtn = screen.getByRole('button', { name: /Зарегистрировать/i });
    await waitFor(() => expect(registerBtn).not.toBeDisabled());
    await user.click(registerBtn);

    await waitFor(() => {
      expect(screen.getByText(/SSH Soul зарегистрирован/i)).toBeInTheDocument();
    });
    // токен не показывается
    expect(screen.queryByText(/Токен отображается ОДИН РАЗ/i)).not.toBeInTheDocument();
  });

  it('ввод двух covens через chips → submit body содержит covens: ["prod","blue"]', async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    installFetchMock([
      {
        method: 'POST',
        url: '/v1/souls',
        status: 201,
        body: {
          sid: 'host-chips.example.com',
          transport: 'agent',
          status: 'pending',
          registered_at: '2026-05-29T10:00:00Z',
          created_by_aid: 'archon-bootstrap',
          bootstrap_token: 'tok-abc',
          expires_at: '2026-05-30T10:00:00Z',
        },
      },
    ]);

    const baseFetch2 = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (init?.body) {
        try { calls.push({ method, url, body: JSON.parse(init.body as string) }); } catch { /* empty */ }
      }
      return baseFetch2(input, init);
    });

    const user = userEvent.setup();
    renderWithProviders(<CreateSoulModal open onClose={() => {}} />);

    const sidInput = screen.getByLabelText('SID нового хоста');
    await user.type(sidInput, 'host-chips.example.com');

    // Вводим первый coven-чип: "prod" + Enter
    const chipsBox = screen.getByLabelText('coven-метки');
    const chipsInput = chipsBox.querySelector('input') as HTMLInputElement;
    await user.click(chipsInput);
    await user.type(chipsInput, 'prod');
    await user.keyboard('{Enter}');

    // Вводим второй coven-чип: "blue" + Enter
    await user.type(chipsInput, 'blue');
    await user.keyboard('{Enter}');

    // Оба чипа отображаются
    expect(screen.getByText('prod')).toBeInTheDocument();
    expect(screen.getByText('blue')).toBeInTheDocument();

    const registerBtn = screen.getByRole('button', { name: /Зарегистрировать/i });
    await waitFor(() => expect(registerBtn).not.toBeDisabled());
    await user.click(registerBtn);

    await waitFor(() => {
      expect(calls.some((c) => {
        const b = c.body as { covens?: string[] };
        return c.method === 'POST' && Array.isArray(b?.covens) && b.covens.includes('prod') && b.covens.includes('blue');
      })).toBe(true);
    });
  });

  it('409 conflict → human-readable ошибка', async () => {
    installFetchMock([
      {
        method: 'POST',
        url: '/v1/souls',
        status: 409,
        body: { type: 'about:blank', title: 'Conflict', detail: 'SID already exists' },
      },
    ]);

    const user = userEvent.setup();
    renderWithProviders(<CreateSoulModal open onClose={() => {}} />);

    const sidInput = screen.getByLabelText('SID нового хоста');
    await user.type(sidInput, 'existing-host.example.com');

    const registerBtn = screen.getByRole('button', { name: /Зарегистрировать/i });
    await waitFor(() => expect(registerBtn).not.toBeDisabled());
    await user.click(registerBtn);

    await waitFor(() => {
      expect(screen.getByText(/Soul с таким SID уже существует/i)).toBeInTheDocument();
    });
  });
});
