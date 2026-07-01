import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  it('create-input: типизированные поля из scenario с create=true, converge не предлагается', async () => {
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
              kind: 'lifecycle',
              path: 'scenario/create/main.yml',
              description: 'init redis',
              create: true,
              input_schema: { maxmemory: { type: 'string', required: true, description: 'memory cap' } },
            },
            { name: 'converge', kind: 'lifecycle', path: 'scenario/converge/main.yml', input_schema: {} },
            { name: 'restart', kind: 'operational', path: 'scenario/restart/main.yml', input_schema: {} },
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

    // Dropdown выбора create-сценария появился.
    expect(await screen.findByTestId('create-scenario-select-wrapper')).toBeInTheDocument();

    // Типизированное поле из create.input_schema появилось.
    expect(await screen.findByTestId('create-input-fields')).toBeInTheDocument();
    expect(screen.getByTestId('field-text-maxmemory')).toBeInTheDocument();

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
              create: true,
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
    const field = screen.getByTestId('field-text-maxmemory') as HTMLInputElement;
    await user.type(field, '512mb');
    expect(submitBtn).not.toBeDisabled();
  });

  // Guard: скрытое required-поле (show_when=false) НЕ блокирует submit.
  it('submit-gate: скрытое required-поле (show_when=false) не блокирует кнопку', async () => {
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
              kind: 'lifecycle',
              path: 'scenario/create/main.yml',
              create: true,
              // mode — обычное поле; slave_of — required, но видим только когда mode=sentinel.
              // С пустым mode show_when=false → поле скрыто → не блокирует submit.
              input_schema: {
                mode: { type: 'string', required: false, description: 'режим' },
                slave_of: {
                  type: 'string',
                  required: true,
                  description: 'master SID',
                },
              },
              form: {
                sections: [
                  {
                    fields: [
                      { name: 'mode' },
                      { name: 'slave_of', show_when: 'input.mode == "sentinel"' },
                    ],
                  },
                ],
              },
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

    // slave_of required но скрыт (mode != "sentinel") → submit НЕ заблокирован.
    const submitBtn = screen.getByRole('button', { name: /Создать incarnation/i });
    expect(submitBtn).not.toBeDisabled();
  });

  // Guard: required_when-предикат истинен → поле блокирует submit.
  it('submit-gate: required_when=true блокирует кнопку', async () => {
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
              kind: 'lifecycle',
              path: 'scenario/create/main.yml',
              create: true,
              input_schema: {
                // required_when с предикатом который всегда true (true == true)
                sentinel_host: {
                  type: 'string',
                  required_when: 'true == true',
                  description: 'sentinel hostname',
                },
              },
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

    // sentinel_host required_when=true и поле пустое → submit ЗАБЛОКИРОВАН.
    const submitBtn = screen.getByRole('button', { name: /Создать incarnation/i });
    expect(submitBtn).toBeDisabled();

    // Заполняем поле → submit разблокирован.
    const field = screen.getByTestId('field-text-sentinel_host') as HTMLInputElement;
    await user.type(field, 'sentinel.example.com');
    expect(submitBtn).not.toBeDisabled();
  });

  it('POST /v1/incarnations отправляется с create_scenario в body', async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : '';
      calls.push({ url, method, body });
      if (method === 'GET' && url.includes('/v1/services/redis/scenarios')) {
        return new Response(
          JSON.stringify({
            service: 'redis',
            ref: 'v2.0.0',
            scenarios: [
              {
                name: 'create',
                kind: 'lifecycle',
                path: 'scenario/create/main.yml',
                create: true,
                input_schema: {},
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
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
    }) as typeof fetch);

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
    // Ждём dropdown create-сценария.
    await screen.findByTestId('create-scenario-select-wrapper');
    await user.click(screen.getByRole('button', { name: /Создать incarnation/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.startsWith('/v1/incarnations'));
      expect(post).toBeTruthy();
      const parsed = JSON.parse(post!.body);
      expect(parsed.name).toBe('redis-prod');
      expect(parsed.service).toBe('redis');
      expect(parsed.input).toEqual({});
      // create_scenario должен присутствовать в теле.
      expect(parsed.create_scenario).toBe('create');
    });
  });

  // Guard: сервис без create-сценариев → bare-инкарнация, POST без create_scenario.
  it('bare-инкарнация: нет create-сценариев — показывается инфо-блок, POST без create_scenario', async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : '';
      calls.push({ url, method, body });
      if (method === 'GET' && url.includes('/v1/services/svc/scenarios')) {
        return new Response(
          JSON.stringify({
            service: 'svc',
            ref: 'v1.0.0',
            scenarios: [
              { name: 'converge', kind: 'lifecycle', path: 'scenario/converge/main.yml', create: false, input_schema: {} },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (method === 'GET' && url.startsWith('/v1/services')) {
        return new Response(
          JSON.stringify({
            items: [{ name: 'svc', git: 'git@…', ref: 'v1.0.0', created_at: '', updated_at: '' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (method === 'POST' && url.startsWith('/v1/incarnations')) {
        return new Response(
          JSON.stringify({ apply_id: '01ARZ', incarnation: 'svc-prod' }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 599 });
    }) as typeof fetch);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/new" element={<IncarnationNewForm />} />
        <Route path="/incarnations/:name" element={<div>detail-stub</div>} />
      </Routes>,
      '/incarnations/new',
    );

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole('option', { name: /svc/ })).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('redis-prod'), 'svc-prod');
    await user.selectOptions(screen.getByRole('combobox'), 'svc');

    // Инфо-блок про bare появился.
    expect(await screen.findByTestId('create-bare-info')).toBeInTheDocument();

    // Dropdown выбора create-сценария НЕ отображается.
    expect(screen.queryByTestId('create-scenario-select-wrapper')).not.toBeInTheDocument();

    // Submit не заблокирован.
    const submitBtn = screen.getByRole('button', { name: /Создать incarnation/i });
    expect(submitBtn).not.toBeDisabled();

    await user.click(submitBtn);

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.startsWith('/v1/incarnations'));
      expect(post).toBeTruthy();
      const parsed = JSON.parse(post!.body);
      expect(parsed.name).toBe('svc-prod');
      // create_scenario не должен присутствовать для bare-инкарнации.
      expect(parsed.create_scenario).toBeUndefined();
    });
  });

  // Guard: два create-сценария → dropdown, выбор переключает input_schema.
  it('multi-create: dropdown переключает input_schema между сценариями', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: /\/v1\/services\/redis\/scenarios$/,
        body: {
          service: 'redis',
          ref: 'v2.0.0',
          scenarios: [
            {
              name: 'create_standalone',
              kind: 'lifecycle',
              path: 'scenario/create_standalone/main.yml',
              create: true,
              description: 'standalone mode',
              input_schema: { port: { type: 'integer', required: true, description: 'port' } },
            },
            {
              name: 'create_sentinel',
              kind: 'lifecycle',
              path: 'scenario/create_sentinel/main.yml',
              create: true,
              description: 'sentinel mode',
              input_schema: { sentinel_port: { type: 'integer', required: true, description: 'sentinel port' } },
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
    await user.selectOptions(screen.getByRole('combobox'), 'redis');

    // Dropdown создания появился.
    const scenarioSelect = await screen.findByTestId('create-scenario-select');
    expect(scenarioSelect).toBeInTheDocument();

    // Первый сценарий пред-выбран → подсказка поля port видна.
    expect(await screen.findByTestId('field-hint-port')).toBeInTheDocument();
    expect(screen.queryByTestId('field-hint-sentinel_port')).not.toBeInTheDocument();

    // Переключаем на create_sentinel.
    await user.selectOptions(scenarioSelect, 'create_sentinel');

    // Теперь видна подсказка поля sentinel_port.
    expect(await screen.findByTestId('field-hint-sentinel_port')).toBeInTheDocument();
    expect(screen.queryByTestId('field-hint-port')).not.toBeInTheDocument();
  });

  // Guard: create_from_souls сценарий → показывается хелп-блок с ссылкой на Souls.
  it('create_from_souls сценарий — отображает хелп-блок с подсказкой онбординга', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: /\/v1\/services\/redis\/scenarios$/,
        body: {
          service: 'redis',
          ref: 'v2.0.0',
          scenarios: [
            {
              name: 'create_from_souls',
              kind: 'lifecycle',
              path: 'scenario/create_from_souls/main.yml',
              description: 'create from existing souls',
              create: true,
              input_schema: {},
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
    await user.selectOptions(screen.getByRole('combobox'), 'redis');

    // Хелп-блок появляется при create_from_souls сценарии.
    expect(await screen.findByTestId('create-from-souls-hint')).toBeInTheDocument();
  });

  // Guard: обычный create сценарий (не from_souls) → хелп-блок НЕ показывается.
  it('обычный create сценарий — хелп-блок from_souls НЕ показывается', async () => {
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
              kind: 'lifecycle',
              path: 'scenario/create/main.yml',
              create: true,
              input_schema: { maxmemory: { type: 'string', required: false } },
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
    await user.selectOptions(screen.getByRole('combobox'), 'redis');

    await screen.findByTestId('create-scenario-select-wrapper');
    expect(screen.queryByTestId('create-from-souls-hint')).not.toBeInTheDocument();
  });
});
