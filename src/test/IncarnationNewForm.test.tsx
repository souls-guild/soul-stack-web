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
  // A create scenario declaring `name_template` composes the name server-side
  // and rejects a request that carries one. The form used to demand a name
  // unconditionally, so those services could not be created from the console at
  // all: no name and zod blocked, a name and the keeper refused (NIM-340).
  //
  // The empty field must therefore arrive as an OMITTED key. Sending `name: ""`
  // would look the same in the form and still be a request that carries `name`.
  // A create scenario that composes its name (`composes_name`) — the mode where the
  // form shows a preview instead of a name field.
  const COMPOSING_SCENARIO = {
    name: 'create',
    kind: 'lifecycle',
    path: 'scenario/create/main.yml',
    create: true,
    runnable: true,
    composes_name: true,
    input_schema: {},
  };

  // A create scenario that does NOT compose — the operator types the name, and it
  // is still required. Keeping both in the suite is the point: the flag has to
  // switch the form, not remove a check everywhere.
  const TYPED_NAME_SCENARIO = {
    name: 'create',
    kind: 'lifecycle',
    path: 'scenario/create/main.yml',
    create: true,
    runnable: true,
    input_schema: {},
  };

  const DEFAULT_RESOLVE = {
    composes: true,
    composed_name: 'cache-billing-redis',
    length: 19,
    max_length: 63,
    valid: true,
    available: true,
  };

  function stubCreate(
    onPost: (body: string) => Response,
    opts: { scenarios?: unknown[]; resolve?: unknown } = {},
  ) {
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
            scenarios: opts.scenarios ?? [
              { name: 'converge', kind: 'lifecycle', path: 'scenario/converge/main.yml', create: false, input_schema: {} },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (method === 'GET' && url.startsWith('/v1/services')) {
        return new Response(
          JSON.stringify({ items: [{ name: 'svc', git: 'git@…', ref: 'v1.0.0', created_at: '', updated_at: '' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // Before the create branch: the resolve lives under the same path prefix, and
      // answering it with the create's stub would make the preview look like a
      // successful create.
      if (method === 'POST' && url.startsWith('/v1/incarnations/resolve-name')) {
        const r = opts.resolve ?? DEFAULT_RESOLVE;
        return r instanceof Response
          ? r.clone()
          : new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (method === 'POST' && url.startsWith('/v1/incarnations')) return onPost(body);
      return new Response('{}', { status: 599 });
    }) as typeof fetch);
    return calls;
  }

  function renderForm() {
    renderWithProviders(
      <Routes>
        <Route path="/incarnations/new" element={<IncarnationNewForm />} />
        <Route path="/incarnations/:name" element={<div>detail-stub</div>} />
      </Routes>,
      '/incarnations/new',
    );
  }

  it('a composing scenario replaces the name field with a preview and sends no name', async () => {
    const calls = stubCreate(
      () =>
        new Response(JSON.stringify({ apply_id: '01ARZ', incarnation: 'cache-billing-redis' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        }),
      { scenarios: [COMPOSING_SCENARIO] },
    );

    renderForm();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole('option', { name: /svc/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByRole('combobox'), 'svc');

    // The operator does not type this name, so offering a field for it invites a
    // request the keeper refuses outright.
    await waitFor(() => expect(screen.getByTestId('composed-name-preview')).toBeInTheDocument());
    expect(screen.queryByTestId('incarnation-name-input')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Create incarnation/i }));

    await waitFor(() => {
      const post = calls.find(
        (c) => c.method === 'POST' && c.url === '/v1/incarnations',
      );
      expect(post, 'a composing scenario must submit without a name').toBeTruthy();
      const parsed = JSON.parse(post!.body) as Record<string, unknown>;
      expect(
        'name' in parsed,
        'the key must be absent — a composing scenario rejects a request that carries `name` at all',
      ).toBe(false);
    });
  });

  // The other half of the same flag, and the one a fix for the templated path is
  // most likely to break: where the operator DOES type the name, it is still
  // required. NIM-340 had to drop that check outright because the scenario list
  // carried no way to tell the two apart.
  it('a scenario that does not compose still requires a name', async () => {
    const calls = stubCreate(() => new Response('{}', { status: 202 }), {
      scenarios: [TYPED_NAME_SCENARIO],
    });

    renderForm();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole('option', { name: /svc/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByRole('combobox'), 'svc');

    expect(screen.getByTestId('incarnation-name-input')).toBeInTheDocument();
    expect(screen.queryByTestId('composed-name-preview')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Create incarnation/i }));

    await waitFor(() =>
      expect(screen.getByTestId('incarnation-name-input')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(
      calls.find((c) => c.method === 'POST' && c.url === '/v1/incarnations'),
      'an empty name must not reach the keeper where the scenario composes nothing',
    ).toBeUndefined();
  });

  // Hiding the input does not clear it. Switching from a scenario the operator typed a name
  // for to one that composes leaves that name in form state, so an omission decided by
  // "is the value empty" ships it anyway — and a composing scenario refuses a request that
  // carries `name` at all. The decision has to be the flag, not the emptiness.
  it('a name typed for a plain scenario is not carried into a composing one', async () => {
    const PLAIN = { ...TYPED_NAME_SCENARIO, name: 'create-plain' };
    const COMPOSING = { ...COMPOSING_SCENARIO, name: 'create-composed' };
    const calls = stubCreate(
      () =>
        new Response(JSON.stringify({ apply_id: '01ARZ', incarnation: 'cache-billing-redis' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        }),
      { scenarios: [PLAIN, COMPOSING] },
    );

    renderForm();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole('option', { name: /svc/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByRole('combobox'), 'svc');

    await screen.findByTestId('incarnation-name-input');
    await user.type(screen.getByTestId('incarnation-name-input'), 'typed-earlier');

    await user.selectOptions(screen.getByTestId('create-scenario-select'), 'create-composed');
    await waitFor(() => expect(screen.getByTestId('composed-name-preview')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Create incarnation/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url === '/v1/incarnations');
      expect(post, 'the composing scenario must still submit').toBeTruthy();
      expect(
        'name' in (JSON.parse(post!.body) as Record<string, unknown>),
        'a name left over from the previous scenario must not be sent',
      ).toBe(false);
    });
  });

  // If the keeper asks for a name while the descriptor said the scenario composes one, the two
  // sides disagree — and there is no input on screen to carry the complaint. Attaching it to
  // the absent field would swallow it and leave the operator with a form that just does
  // nothing on submit.
  it('the keeper contradicting the flag reaches the operator instead of a hidden field', async () => {
    stubCreate(
      () =>
        new Response(
          JSON.stringify({ title: 'Validation failed', status: 422, detail: "field 'name' is required" }),
          { status: 422, headers: { 'Content-Type': 'application/json' } },
        ),
      { scenarios: [COMPOSING_SCENARIO] },
    );

    renderForm();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole('option', { name: /svc/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByRole('combobox'), 'svc');
    await waitFor(() => expect(screen.getByTestId('composed-name-preview')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Create incarnation/i }));

    const box = await screen.findByTestId('incarnation-create-error');
    expect(box).toHaveTextContent(/does not compose a name/i);
    expect(screen.queryByTestId('incarnation-name-input')).toBeNull();
  });

  // The name is the immutable primary key: the operator has to read it before the
  // create makes it permanent, and read how close it is to the ceiling that would
  // refuse it.
  it('the preview shows the composed name and its length', async () => {
    stubCreate(() => new Response('{}', { status: 202 }), { scenarios: [COMPOSING_SCENARIO] });

    renderForm();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole('option', { name: /svc/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByRole('combobox'), 'svc');

    await waitFor(() => expect(screen.getByTestId('composed-name-value')).toHaveTextContent('cache-billing-redis'));
    expect(screen.getByTestId('composed-name-counter')).toHaveTextContent('19');
    expect(screen.getByTestId('composed-name-counter')).toHaveTextContent('63');
    expect(screen.getByTestId('composed-name-free')).toBeInTheDocument();
  });

  // Seeing the collision BEFORE pressing create is the point: under a template the
  // 409 names a string the operator never typed.
  it('a taken name is visible before the create is attempted', async () => {
    stubCreate(() => new Response('{}', { status: 202 }), {
      scenarios: [COMPOSING_SCENARIO],
      resolve: { ...DEFAULT_RESOLVE, available: false, taken_by_service: 'redis' },
    });

    renderForm();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole('option', { name: /svc/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByRole('combobox'), 'svc');

    await waitFor(() => expect(screen.getByTestId('composed-name-taken')).toHaveTextContent(/redis/));
    expect(screen.queryByTestId('composed-name-free')).toBeNull();
  });

  // A preview that cannot be composed must SAY why. Going silently blank is the
  // failure the endpoint was opened to remove — the operator is left staring at an
  // empty box with four fields and no clue which one is at fault.
  it('an uncomposable name explains itself instead of going blank', async () => {
    stubCreate(() => new Response('{}', { status: 202 }), {
      scenarios: [COMPOSING_SCENARIO],
      resolve: {
        composes: true,
        composed_name: '',
        length: 0,
        max_length: 63,
        valid: false,
        invalid_reason: 'the name cannot be composed yet — no such key: project',
        available: false,
      },
    });

    renderForm();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole('option', { name: /svc/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByRole('combobox'), 'svc');

    await waitFor(() =>
      expect(screen.getByTestId('composed-name-incomplete')).toHaveTextContent(/project/),
    );
  });

  it('a malformed name is still rejected before the request', async () => {
    const calls = stubCreate(() => new Response('{}', { status: 202 }));

    renderForm();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole('option', { name: /svc/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByRole('combobox'), 'svc');
    await user.type(screen.getByPlaceholderText('redis-prod'), 'Not Kebab');
    await user.click(screen.getByRole('button', { name: /Create incarnation/i }));

    // Asserted on the field state, not on the message: the label itself reads
    // "Name (kebab-case)", so matching that text finds two elements.
    await waitFor(() =>
      expect(screen.getByTestId('incarnation-name-input')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(
      calls.find((c) => c.method === 'POST'),
      'dropping the required-check must not drop the format check',
    ).toBeUndefined();
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
