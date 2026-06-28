import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { IncarnationNewForm } from '../pages/incarnations/IncarnationNewForm';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

// ─── минимальный fetchMock для тестов ─────────────────────────────────────────

const SERVICES_MOCK = {
  method: 'GET' as const,
  url: '/v1/services',
  body: { items: [{ name: 'redis', git: 'git@…', ref: 'v2.0.0', created_at: '', updated_at: '' }] },
};

function renderForm() {
  return renderWithProviders(
    <Routes>
      <Route path="/incarnations/new" element={<IncarnationNewForm />} />
      <Route path="/incarnations/:name" element={<div>detail-stub</div>} />
    </Routes>,
    '/incarnations/new',
  );
}

describe('TraitsEditor в форме создания инкарнации', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('traits-секция рендерится в форме', async () => {
    installFetchMock([SERVICES_MOCK]);
    renderForm();
    expect(await screen.findByTestId('traits-editor')).toBeInTheDocument();
  });

  it('добавление строки trait по кнопке', async () => {
    installFetchMock([SERVICES_MOCK]);
    renderForm();
    const user = userEvent.setup();

    await screen.findByTestId('traits-editor');
    expect(screen.queryAllByTestId('trait-row')).toHaveLength(0);

    await user.click(screen.getByTestId('traits-add-row'));
    expect(screen.getAllByTestId('trait-row')).toHaveLength(1);
  });

  it('удаление строки trait', async () => {
    installFetchMock([SERVICES_MOCK]);
    renderForm();
    const user = userEvent.setup();

    await screen.findByTestId('traits-editor');
    await user.click(screen.getByTestId('traits-add-row'));
    expect(screen.getAllByTestId('trait-row')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /Удалить trait/i }));
    expect(screen.queryAllByTestId('trait-row')).toHaveLength(0);
  });

  it('переключение режима string → list', async () => {
    installFetchMock([SERVICES_MOCK]);
    renderForm();
    const user = userEvent.setup();

    await screen.findByTestId('traits-editor');
    await user.click(screen.getByTestId('traits-add-row'));

    const toggleBtn = screen.getByTestId('trait-mode-toggle');
    // изначально string-режим — кнопка показывает `[ ]`
    expect(toggleBtn).toHaveTextContent('[ ]');

    await user.click(toggleBtn);
    // после переключения — list-режим, кнопка показывает `"…"`
    expect(toggleBtn).toHaveTextContent('"…"');
  });

  it('traits с строковым значением уходят в POST create-request', async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : '';
      calls.push({ url, method, body });
      if (method === 'GET' && url.startsWith('/v1/services')) {
        return new Response(
          JSON.stringify({ items: [{ name: 'redis', git: 'git@…', ref: 'v2.0.0', created_at: '', updated_at: '' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (method === 'POST' && url.startsWith('/v1/incarnations')) {
        return new Response(
          JSON.stringify({ apply_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', incarnation: 'redis-prod' }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 599 });
    }) as typeof fetch);

    renderForm();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole('option', { name: /redis/ })).toBeInTheDocument());

    // Заполняем name + service
    await user.type(screen.getByPlaceholderText('redis-prod'), 'redis-prod');
    await user.selectOptions(screen.getByRole('combobox'), 'redis');

    // Добавляем trait: key=env, value=prod
    await user.click(screen.getByTestId('traits-add-row'));
    const [keyInput] = screen.getAllByRole('textbox', { name: /ключ trait/i });
    await user.type(keyInput, 'env');
    const [valInput] = screen.getAllByRole('textbox', { name: /значение trait/i });
    await user.type(valInput, 'prod');

    await user.click(screen.getByRole('button', { name: /Создать incarnation/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.startsWith('/v1/incarnations'));
      expect(post).toBeTruthy();
      const parsed = JSON.parse(post!.body);
      expect(parsed.traits).toEqual({ env: 'prod' });
    });
  });

  it('traits без ключей НЕ уходят в POST (пустые строки игнорируются)', async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : '';
      calls.push({ url, method, body });
      if (method === 'GET' && url.startsWith('/v1/services')) {
        return new Response(
          JSON.stringify({ items: [{ name: 'redis', git: 'git@…', ref: 'v2.0.0', created_at: '', updated_at: '' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (method === 'POST' && url.startsWith('/v1/incarnations')) {
        return new Response(
          JSON.stringify({ apply_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', incarnation: 'redis-prod' }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 599 });
    }) as typeof fetch);

    renderForm();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole('option', { name: /redis/ })).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('redis-prod'), 'redis-prod');
    await user.selectOptions(screen.getByRole('combobox'), 'redis');

    // Добавляем строку, но НЕ заполняем ключ
    await user.click(screen.getByTestId('traits-add-row'));

    await user.click(screen.getByRole('button', { name: /Создать incarnation/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.startsWith('/v1/incarnations'));
      expect(post).toBeTruthy();
      const parsed = JSON.parse(post!.body);
      // traits отсутствует (не передаём пустой объект)
      expect(parsed.traits).toBeUndefined();
    });
  });
});
