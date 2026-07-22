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
  it('zod validation: empty name blocks submit', async () => {
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
    await user.click(screen.getByRole('button', { name: /Create incarnation/i }));
    expect(await screen.findByText(/required field/i)).toBeInTheDocument();
  });

  it('create-input: typed fields from scenario with create=true, converge not offered', async () => {
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

    // Create-scenario select dropdown appeared.
    expect(await screen.findByTestId('create-scenario-select-wrapper')).toBeInTheDocument();

    // Typed field from create.input_schema appeared.
    expect(await screen.findByTestId('create-input-fields')).toBeInTheDocument();
    expect(screen.getByTestId('field-text-maxmemory')).toBeInTheDocument();

    // converge / restart are not offered as input fields and there is no generic builder.
    expect(screen.queryByText(/^converge/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Scenario create input fields')).not.toBeInTheDocument();
  });

  it('create-input: empty required field blocks submit + inline error', async () => {
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

    // Submit disabled while required maxmemory is empty.
    const submitBtn = screen.getByRole('button', { name: /Create incarnation/i });
    expect(submitBtn).toBeDisabled();

    // Fill required -> submit unblocked.
    const field = screen.getByTestId('field-text-maxmemory') as HTMLInputElement;
    await user.type(field, '512mb');
    expect(submitBtn).not.toBeDisabled();
  });

  // Guard: hidden required field (show_when=false) does NOT block submit.
  it('submit-gate: hidden required field (show_when=false) does not block the button', async () => {
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
              // mode - a regular field; slave_of - required, but shown only when mode=sentinel.
              // With empty mode show_when=false -> field hidden -> does not block submit.
              input_schema: {
                mode: { type: 'string', required: false, description: 'mode' },
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

    // slave_of required but hidden (mode != "sentinel") -> submit NOT blocked.
    const submitBtn = screen.getByRole('button', { name: /Create incarnation/i });
    expect(submitBtn).not.toBeDisabled();
  });

  // Guard: required_when predicate is true -> field blocks submit.
  it('submit-gate: required_when=true blocks the button', async () => {
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
                // required_when with a predicate that is always true (true == true)
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

    // sentinel_host required_when=true and field is empty -> submit BLOCKED.
    const submitBtn = screen.getByRole('button', { name: /Create incarnation/i });
    expect(submitBtn).toBeDisabled();

    // Fill field -> submit unblocked.
    const field = screen.getByTestId('field-text-sentinel_host') as HTMLInputElement;
    await user.type(field, 'sentinel.example.com');
    expect(submitBtn).not.toBeDisabled();
  });

  it('POST /v1/incarnations is sent with create_scenario in body', async () => {
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
    // Wait for services.
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /redis/ })).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText('redis-prod'), 'redis-prod');
    await user.selectOptions(screen.getByRole('combobox'), 'redis');
    // Wait for create-scenario dropdown.
    await screen.findByTestId('create-scenario-select-wrapper');
    await user.click(screen.getByRole('button', { name: /Create incarnation/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.startsWith('/v1/incarnations'));
      expect(post).toBeTruthy();
      const parsed = JSON.parse(post!.body);
      expect(parsed.name).toBe('redis-prod');
      expect(parsed.service).toBe('redis');
      expect(parsed.input).toEqual({});
      // create_scenario must be present in the body.
      expect(parsed.create_scenario).toBe('create');
    });
  });

  // Guard: service without create-scenarios -> bare incarnation, POST without create_scenario.
  it('bare incarnation: no create scenarios — info block shown, POST without create_scenario', async () => {
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

    // Info block about bare appeared.
    expect(await screen.findByTestId('create-bare-info')).toBeInTheDocument();

    // Create-scenario select dropdown is NOT displayed.
    expect(screen.queryByTestId('create-scenario-select-wrapper')).not.toBeInTheDocument();

    // Submit not blocked.
    const submitBtn = screen.getByRole('button', { name: /Create incarnation/i });
    expect(submitBtn).not.toBeDisabled();

    await user.click(submitBtn);

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.startsWith('/v1/incarnations'));
      expect(post).toBeTruthy();
      const parsed = JSON.parse(post!.body);
      expect(parsed.name).toBe('svc-prod');
      // create_scenario must not be present for a bare incarnation.
      expect(parsed.create_scenario).toBeUndefined();
    });
  });

  // Guard: two create scenarios -> dropdown, selection switches input_schema.
  it('multi-create: dropdown switches input_schema between scenarios', async () => {
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

    // Create dropdown appeared.
    const scenarioSelect = await screen.findByTestId('create-scenario-select');
    expect(scenarioSelect).toBeInTheDocument();

    // First scenario pre-selected -> port field hint is visible.
    expect(await screen.findByTestId('field-hint-port')).toBeInTheDocument();
    expect(screen.queryByTestId('field-hint-sentinel_port')).not.toBeInTheDocument();

    // Switch to create_sentinel.
    await user.selectOptions(scenarioSelect, 'create_sentinel');

    // Now the sentinel_port field hint is visible.
    expect(await screen.findByTestId('field-hint-sentinel_port')).toBeInTheDocument();
    expect(screen.queryByTestId('field-hint-port')).not.toBeInTheDocument();
  });

  // Guard: create_from_souls scenario -> help block with a link to Souls is shown.
  it('create_from_souls scenario — shows help block with onboarding hint', async () => {
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

    // Help block appears for the create_from_souls scenario.
    expect(await screen.findByTestId('create-from-souls-hint')).toBeInTheDocument();
  });

  // Guard: regular create scenario (not from_souls) -> help block is NOT shown.
  it('regular create scenario — from_souls help block is NOT shown', async () => {
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
