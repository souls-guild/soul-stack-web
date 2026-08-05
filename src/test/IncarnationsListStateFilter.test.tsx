// Tests: incarnation state filter (ADR-042 dumb frontend + server-side sort + snapshot Run).
//
// Checks:
// 1. Filter panel does not appear without selecting a service.
// 2. On service selection - state-schema is fetched, fields come from the schema (not hardcoded).
// 3. Adding a predicate -> request to /v1/incarnations with state.<field>=<op>:<value>.
// 4. 422 from backend -> per-field error, no crash.
// 5. Server-side sort: sorting is passed as sort/sort_dir, not client-side.
// 6. Total counter from backend response.
// 7. "Run on set" button -> navigate with service + incarnation_regex (param NOT incarnation).
// 8. RunWizard with ?incarnation_regex=... actually resolves the list of incarnations (not an escaped literal).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { renderWithProviders } from './renderWithProviders';
import { IncarnationsList } from '../pages/incarnations/IncarnationsList';
import { RunWizard } from '../pages/run/RunWizard';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

const SERVICES_REPLY = {
  items: [{ name: 'redis', ref: 'main' }, { name: 'postgres', ref: 'v2' }],
  total: 2,
};

const STATE_SCHEMA_REPLY = {
  service: 'redis',
  ref: 'main',
  state_schema_version: 1,
  schema: {
    type: 'object',
    required: ['redis_version'],
    properties: {
      redis_version: { type: 'string' },
      maxmemory: { type: 'integer' },
    },
  },
  migrations: [],
};

const INCARNATIONS_REPLY = {
  items: [
    {
      name: 'redis-prod',
      service: 'redis',
      service_version: 'main',
      status: 'ready',
      covens: ['prod'],
      created_at: new Date().toISOString(),
      last_drift_check_at: null,
      state: {},
    },
    {
      name: 'redis-staging',
      service: 'redis',
      service_version: 'main',
      status: 'ready',
      covens: ['staging'],
      created_at: new Date().toISOString(),
      last_drift_check_at: null,
      state: {},
    },
  ],
  total: 2,
};

// Wait until select gets an option with the needed value.
async function waitForOption(select: HTMLElement, value: string) {
  await waitFor(() => {
    const opt = within(select as HTMLSelectElement).queryByRole('option', { name: value });
    expect(opt).toBeInTheDocument();
  });
}

describe('IncarnationsList — state filter', () => {
  beforeEach(() => {
    tokenStore.clear();
    navigateSpy.mockReset();
  });
  it('state filter panel is hidden without selecting a service', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/services', body: SERVICES_REPLY },
      { method: 'GET', url: '/v1/incarnations', body: { items: [], total: 0 } },
    ]);
    renderWithProviders(<IncarnationsList />, '/incarnations');
    await waitFor(() => {
      expect(screen.getAllByText(/select a service to filter by state fields/i).length).toBeGreaterThan(0);
    });
    // "Add condition" button should not be present until service is selected.
    expect(screen.queryByText(/add condition/i)).not.toBeInTheDocument();
  });

  it('fields come from the schema (not hardcoded) after selecting a service', async () => {
    // More specific route (/v1/services/redis/state-schema) must come before
    // the general one (/v1/services), otherwise startsWith matching will pick the wrong route.
    installFetchMock([
      { method: 'GET', url: '/v1/services/redis/state-schema', body: STATE_SCHEMA_REPLY },
      { method: 'GET', url: '/v1/services', body: SERVICES_REPLY },
      { method: 'GET', url: '/v1/incarnations', body: INCARNATIONS_REPLY },
    ]);
    renderWithProviders(<IncarnationsList />, '/incarnations');

    // Wait for services to load (option redis appears in select).
    const allSelects = screen.getAllByRole('combobox');
    const serviceSelect = allSelects[0]; // first select = service
    await waitForOption(serviceSelect, 'redis');
    await userEvent.selectOptions(serviceSelect, 'redis');

    // Wait for "Add condition" button to appear (panel loads the schema).
    const addBtn = await screen.findByRole('button', { name: /add condition/i });

    // Add a predicate.
    await userEvent.click(addBtn);

    // Check: field select has schema fields redis_version and maxmemory (not hardcoded - from schema).
    const fieldSelect = screen.getByRole('combobox', { name: /state field/i });
    const options = within(fieldSelect).getAllByRole('option');
    const optionValues = options.map((o) => o.textContent);
    expect(optionValues).toContain('redis_version');
    expect(optionValues).toContain('maxmemory');
  });

  it('sends state.<field>=<op>:<value> when the predicate is filled', async () => {
    let capturedUrl: string | null = null;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (urlStr.startsWith('/v1/services/redis/state-schema')) {
        return new Response(JSON.stringify(STATE_SCHEMA_REPLY), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.startsWith('/v1/services')) {
        return new Response(JSON.stringify(SERVICES_REPLY), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'GET' && urlStr.startsWith('/v1/incarnations')) {
        capturedUrl = urlStr;
        return new Response(JSON.stringify(INCARNATIONS_REPLY), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ title: 'not mocked', detail: urlStr }), { status: 599 });
    }));

    renderWithProviders(<IncarnationsList />, '/incarnations');

    const allSelects = screen.getAllByRole('combobox');
    await waitForOption(allSelects[0], 'redis');
    await userEvent.selectOptions(allSelects[0], 'redis');

    const addBtn2 = await screen.findByRole('button', { name: /add condition/i });
    await userEvent.click(addBtn2);

    // Select the maxmemory field.
    const fieldSelect = screen.getByRole('combobox', { name: /state field/i });
    await userEvent.selectOptions(fieldSelect, 'maxmemory');

    // Set the gte operator.
    const opSelect = screen.getByRole('combobox', { name: /operator/i });
    await userEvent.selectOptions(opSelect, 'gte');

    // Enter a value.
    const valueInput = screen.getByRole('spinbutton', { name: /value/i });
    await userEvent.clear(valueInput);
    await userEvent.type(valueInput, '1024');

    // Wait for the request with the state predicate.
    await waitFor(() => {
      expect(capturedUrl).not.toBeNull();
      // URL contains state.maxmemory=gte:1024 (URL-encoded).
      expect(decodeURIComponent(capturedUrl!)).toContain('state.maxmemory=gte:1024');
    }, { timeout: 3000 });
  });

  it('422 from backend shows an error, no crash', async () => {
    // First request to incarnations returns 422 immediately (without state filters).
    // To trigger 422 with a filled predicate - create a mock,
    // that always returns 422 for /v1/incarnations.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (urlStr.startsWith('/v1/services/redis/state-schema')) {
        return new Response(JSON.stringify(STATE_SCHEMA_REPLY), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.startsWith('/v1/services')) {
        return new Response(JSON.stringify(SERVICES_REPLY), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'GET' && urlStr.startsWith('/v1/incarnations')) {
        // If the request contains a state predicate - return 422.
        if (urlStr.includes('state.')) {
          return new Response(
            JSON.stringify({ title: 'Unprocessable Entity', detail: 'state.maxmemory: non-numeric value for operator gte' }),
            { status: 422, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ items: [], total: 0 }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 599 });
    }));

    renderWithProviders(<IncarnationsList />, '/incarnations');

    const allSelects = screen.getAllByRole('combobox');
    await waitForOption(allSelects[0], 'redis');
    await userEvent.selectOptions(allSelects[0], 'redis');

    await waitFor(() => {
      expect(screen.getByText(/add condition/i)).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText(/add condition/i));

    const fieldSelect = screen.getByRole('combobox', { name: /state field/i });
    await userEvent.selectOptions(fieldSelect, 'maxmemory');

    const opSelect = screen.getByRole('combobox', { name: /operator/i });
    await userEvent.selectOptions(opSelect, 'gte');

    const valueInput = screen.getByRole('spinbutton', { name: /value/i });
    await userEvent.clear(valueInput);
    await userEvent.type(valueInput, '100');

    await waitFor(() => {
      expect(screen.getByText(/filter error/i)).toBeInTheDocument();
    });
  });

  it('total from backend response is displayed', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/services', body: SERVICES_REPLY },
      { method: 'GET', url: '/v1/incarnations', body: INCARNATIONS_REPLY },
    ]);
    renderWithProviders(<IncarnationsList />, '/incarnations');

    await waitFor(() => {
      expect(screen.getByText(/Total: 2 incarnations/)).toBeInTheDocument();
    });
  });

  it('sort is passed as a query param (server-side)', async () => {
    let capturedUrl: string | null = null;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.startsWith('/v1/services')) {
        return new Response(JSON.stringify(SERVICES_REPLY), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (method === 'GET' && urlStr.startsWith('/v1/incarnations')) {
        capturedUrl = urlStr;
        return new Response(JSON.stringify(INCARNATIONS_REPLY), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    renderWithProviders(<IncarnationsList />, '/incarnations');

    // Default sort=created_at desc.
    await waitFor(() => {
      expect(capturedUrl).not.toBeNull();
      expect(capturedUrl).toContain('sort=created_at');
      expect(capturedUrl).toContain('sort_dir=desc');
    });

    // Wait for table render and sort button.
    await waitFor(() => {
      expect(screen.getByText('redis-prod')).toBeInTheDocument();
    });

    // Click on the Name column - sort should change.
    capturedUrl = null;
    // Sort button is inside th; find by full text.
    const sortButtons = screen.getAllByRole('button');
    const nameBtn = sortButtons.find((b) => b.textContent?.trim().startsWith('Name'));
    expect(nameBtn).toBeDefined();
    await userEvent.click(nameBtn!);

    await waitFor(() => {
      expect(capturedUrl).not.toBeNull();
      expect(capturedUrl).toContain('sort=name');
      expect(capturedUrl).toContain('sort_dir=asc');
    });
  });

  it('«Run on set» button calls navigate with service + incarnation regex (snapshot)', async () => {
    // More specific route (/v1/services/redis/state-schema) must come before
    // the general one (/v1/services), otherwise startsWith matching will pick the wrong route.
    installFetchMock([
      { method: 'GET', url: '/v1/services/redis/state-schema', body: STATE_SCHEMA_REPLY },
      { method: 'GET', url: '/v1/services', body: SERVICES_REPLY },
      { method: 'GET', url: '/v1/incarnations', body: INCARNATIONS_REPLY },
    ]);
    renderWithProviders(<IncarnationsList />, '/incarnations');

    const allSelects = screen.getAllByRole('combobox');
    await waitForOption(allSelects[0], 'redis');
    await userEvent.selectOptions(allSelects[0], 'redis');

    await waitFor(() => {
      expect(screen.getByText(/add condition/i)).toBeInTheDocument();
    });

    // Add a predicate: switch field to maxmemory (integer -> spinbutton),
    // then enter a value so the predicate becomes active and the Run button appears.
    await userEvent.click(screen.getByText(/add condition/i));
    const fieldSelect = screen.getByRole('combobox', { name: /state field/i });
    await userEvent.selectOptions(fieldSelect, 'maxmemory');
    const valueInput = screen.getByRole('spinbutton', { name: /value/i });
    await userEvent.type(valueInput, '100');

    // Wait for results to load.
    await waitFor(() => {
      expect(screen.getByText('redis-prod')).toBeInTheDocument();
    });

    // "Run on set" button should appear.
    // aria-label = runSetAria = "Run scenario..." - accessible name for AT;
    // button text content - "Run on set".
    const runBtn = await screen.findByRole('button', { name: /run a scenario on the filtered set/i });
    await userEvent.click(runBtn);

    expect(navigateSpy).toHaveBeenCalledOnce();
    const calledWith: string = navigateSpy.mock.calls[0][0];
    expect(calledWith).toContain('/run');
    expect(calledWith).toContain('service=redis');
    // CRITICAL: param must be incarnation_regex (not incarnation).
    // incarnation (a single name) is wrapped by RunWizard in ^...$ - for snapshot-OR this is
    // double escaping, and the regex will not match any incarnation.
    expect(calledWith).toContain('incarnation_regex=');
    expect(calledWith).not.toContain('&incarnation=');
    // Regex must contain the incarnation names.
    const decoded = decodeURIComponent(calledWith);
    expect(decoded).toContain('redis-prod');
    expect(decoded).toContain('redis-staging');
  });

  it('RunWizard with ?incarnation_regex actually resolves the list (not an escaped literal)', async () => {
    // This test reproduces finding 1/2 from review: snapshot-Run passed regex via
    // param `incarnation`, which RunWizard wrapped again in ^...$ -> double escaping
    // -> incarnationRegex contained an escaped literal instead of a live OR-regex -> 0 matches.
    //
    // After the fix, IncarnationsList uses `incarnation_regex`, RunWizard puts it
    // as-is into incarnationRegex. Step3 should show both incarnations matched by the regex.

    const INCARNATION_NAMES = ['redis-prod', 'redis-staging'];
    const snapshotRegex = `^(${INCARNATION_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`;

    // Common fetch stub for RunWizard.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const json = (obj: unknown, status = 200) =>
        new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

      if (url.includes('/v1/services/redis/scenarios')) {
        return json({ service: 'redis', ref: 'main', scenarios: [{ name: 'restart', kind: 'operational' }] });
      }
      if (url.includes('/v1/services')) {
        return json({ items: [{ name: 'redis', ref: 'main' }], total: 1 });
      }
      if (url.includes('/v1/incarnations')) {
        return json({
          items: INCARNATION_NAMES.map((name) => ({
            name, service: 'redis', service_version: 'main',
            state_schema_version: 1, covens: ['prod'], status: 'ready',
            created_by_aid: 'archon-x', created_at: '', updated_at: '',
          })),
          total: INCARNATION_NAMES.length,
        });
      }
      if (url.includes('/v1/souls')) {
        return json({ items: [], total: 0 });
      }
      if (url.includes('/v1/modules')) {
        return json({ items: [] });
      }
      return new Response('{}', { status: 404 });
    }));

    // URL as if it came from IncarnationsList.handleRunSet.
    const initialPath = `/run?workload=scenario&service=redis&incarnation_regex=${encodeURIComponent(snapshotRegex)}`;

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 }, mutations: { retry: false } },
    });
    function Wrap({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
        </QueryClientProvider>
      );
    }
    render(
      <Routes>
        <Route path="/run" element={<RunWizard />} />
      </Routes>,
      { wrapper: Wrap },
    );

    // Move Step1 -> Step2.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Next/ }));

    // In Step2 service is already selected from query - select scenario.
    await waitFor(() => expect(screen.getByLabelText(/Service/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('option', { name: /restart/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Scenario/), 'restart');

    // Move Step2 -> Step3 (incarnation regex).
    await user.click(screen.getByRole('button', { name: /Next/ }));

    // incarnationRegex is already filled from ?incarnation_regex (not wrapped again).
    // After incarnations load, the matched list should contain BOTH.
    await waitFor(() => {
      const matchList = screen.getByLabelText('Matched incarnations').textContent ?? '';
      // REAL CHECK: both names are visible, not an empty list due to double escaping.
      expect(matchList).toContain('redis-prod');
      expect(matchList).toContain('redis-staging');
    }, { timeout: 3000 });

    // Additionally: "Next" is not blocked (there are matches).
    expect(screen.getByRole('button', { name: /Next/ })).not.toBeDisabled();
  });
});
