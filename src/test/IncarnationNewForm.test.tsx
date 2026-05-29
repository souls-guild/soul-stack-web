import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { IncarnationNewForm } from '../pages/incarnations/IncarnationNewForm';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

describe('IncarnationNewForm', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('zod-валидация: пустое name блокирует submit', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/services',
        body: { items: [{ name: 'redis', git: 'git@…', ref: 'v2.0.0', created_at: '', updated_at: '' }] },
      },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/new" element={<IncarnationNewForm />} />
      </Routes>,
      '/incarnations/new',
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Создать incarnation/i }));
    expect(await screen.findByText(/обязательное поле/i)).toBeInTheDocument();
  });

  it('create-input: типизированные поля из scenario `create`, converge не предлагается', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: /\/v1\/services\/redis\/scenarios$/,
        body: {
          service: 'redis',
          ref: 'v2.0.0',
          scenarios: [
            {
              name: 'create',
              path: 'scenario/create/main.yml',
              description: 'init redis',
              input_schema: { maxmemory: { type: 'string', required: true, description: 'memory cap' } },
            },
            { name: 'converge', path: 'scenario/converge/main.yml', input_schema: {} },
            { name: 'restart', path: 'scenario/restart/main.yml', input_schema: {} },
          ],
        },
      },
      {
        method: 'GET',
        url: '/v1/services',
        body: { items: [{ name: 'redis', git: 'git@…', ref: 'v2.0.0', created_at: '', updated_at: '' }] },
      },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/new" element={<IncarnationNewForm />} />
      </Routes>,
      '/incarnations/new',
    );

    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /redis/ })).toBeInTheDocument();
    });
    await user.selectOptions(screen.getByRole('combobox'), 'redis');

    // Типизированное поле из create.input_schema появилось.
    expect(await screen.findByTestId('create-input-fields')).toBeInTheDocument();
    expect(screen.getByText(/^maxmemory \*?$/)).toBeInTheDocument();

    // converge / restart не предлагаются как поля input и нет generic-билдера.
    expect(screen.queryByText(/^converge/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Scenario create input fields')).not.toBeInTheDocument();
  });

  it('create-input: пустое required-поле блокирует submit + inline-ошибка', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: /\/v1\/services\/redis\/scenarios$/,
        body: {
          service: 'redis',
          ref: 'v2.0.0',
          scenarios: [
            {
              name: 'create',
              path: 'scenario/create/main.yml',
              description: 'init redis',
              input_schema: { maxmemory: { type: 'string', required: true, description: 'memory cap' } },
            },
          ],
        },
      },
      {
        method: 'GET',
        url: '/v1/services',
        body: { items: [{ name: 'redis', git: 'git@…', ref: 'v2.0.0', created_at: '', updated_at: '' }] },
      },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/new" element={<IncarnationNewForm />} />
      </Routes>,
      '/incarnations/new',
    );

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole('option', { name: /redis/ })).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('redis-prod'), 'redis-prod');
    await user.selectOptions(screen.getByRole('combobox'), 'redis');
    await screen.findByTestId('create-input-fields');

    // Submit disabled пока required maxmemory пуст.
    const submitBtn = screen.getByRole('button', { name: /Создать incarnation/i });
    expect(submitBtn).toBeDisabled();

    // Заполняем required → submit разблокирован.
    const field = screen.getByText(/^maxmemory \*?$/).parentElement?.querySelector('input') as HTMLInputElement;
    await user.type(field, '512mb');
    expect(submitBtn).not.toBeDisabled();
  });

  it('POST /v1/incarnations отправляется с типизированным body', async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : '';
      calls.push({ url, method, body });
      if (method === 'GET' && url.startsWith('/v1/services')) {
        return new Response(
          JSON.stringify({
            items: [{ name: 'redis', git: 'git@…', ref: 'v2.0.0', created_at: '', updated_at: '' }],
          }),
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
    }) as typeof fetch;

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/new" element={<IncarnationNewForm />} />
        <Route path="/incarnations/:name" element={<div>detail-stub</div>} />
      </Routes>,
      '/incarnations/new',
    );

    const user = userEvent.setup();
    // Дожидаемся services.
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /redis/ })).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText('redis-prod'), 'redis-prod');
    await user.selectOptions(screen.getByRole('combobox'), 'redis');
    await user.click(screen.getByRole('button', { name: /Создать incarnation/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.startsWith('/v1/incarnations'));
      expect(post).toBeTruthy();
      const parsed = JSON.parse(post!.body);
      expect(parsed.name).toBe('redis-prod');
      expect(parsed.service).toBe('redis');
      expect(parsed.input).toEqual({});
    });
  });
});
