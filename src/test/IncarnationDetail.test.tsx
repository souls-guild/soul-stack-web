import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { IncarnationDetail } from '../pages/incarnations/IncarnationDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

describe('IncarnationDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  it('рендерит detail incarnation-а и Overview summary с переходами на Spec/State/Schema/Hosts', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations/redis-prod',
        body: {
          name: 'redis-prod',
          service: 'redis',
          service_version: 'v2.0.0',
          state_schema_version: 3,
          covens: ['prod'],
          spec: { replicas: 3, hosts: [{ sid: 'agent-04.local', role: 'master' }] },
          state: {
            greeting_file: '/tmp/x',
            primary: 'host01.example.com',
            hosts: {
              'agent-04.local': { role: 'master', redis_pid: 1234 },
              'soul-debian-01.local': { role: 'replica' },
            },
          },
          status: 'ready',
          created_by_aid: 'archon-alice',
          created_at: '2026-05-20T10:00:00Z',
          updated_at: '2026-05-25T12:00:00Z',
          last_drift_check_at: '2026-05-25T11:30:00Z',
        },
      },
      // Connected souls for Overview Hosts card (real online count).
      {
        method: 'GET',
        url: '/v1/souls',
        body: {
          items: [
            { sid: 'agent-04.local', status: 'active', covens: ['redis-prod'], transport: 'agent' },
            { sid: 'soul-debian-01.local', status: 'active', covens: ['redis-prod'], transport: 'agent' },
          ],
          offset: 0,
          limit: 200,
          total: 2,
        },
      },
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

    // Default tab - Overview, we see Data summary.
    expect(screen.getByRole('heading', { name: 'Data summary' })).toBeInTheDocument();
    // Hosts card: 2 online (from souls API) + 1 declared (from spec.hosts).
    await waitFor(() => {
      expect(screen.getByText(/2 online/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/1 declared/i)).toBeInTheDocument();

    // Action-bar for status=ready.
    expect(screen.getByRole('button', { name: /Run Scenario/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Destroy/i })).toBeInTheDocument();

    const user = userEvent.setup();

    // Tab «Spec» — declared.
    await user.click(screen.getByRole('tab', { name: /Spec/i }));
    expect(screen.getByRole('heading', { name: /Spec \(declared\)/i })).toBeInTheDocument();
    // Top-level keys in JsonKeyFilter (replicas, hosts).
    expect(screen.getByText('replicas')).toBeInTheDocument();
    expect(screen.getAllByText('hosts').length).toBeGreaterThan(0);

    // Tab «State».
    await user.click(screen.getByRole('tab', { name: /^State/i }));
    expect(screen.getByRole('heading', { name: /Runtime State/i })).toBeInTheDocument();
    expect(screen.getByText(/state_schema_version:/i)).toBeInTheDocument();
    // Per-host data section shows 2 hosts.
    expect(screen.getByRole('heading', { name: /Per-host data/i })).toBeInTheDocument();
    expect(screen.getByText('agent-04.local')).toBeInTheDocument();
    expect(screen.getByText('soul-debian-01.local')).toBeInTheDocument();

    // Tab «Schema».
    await user.click(screen.getByRole('tab', { name: /Schema/i }));
    expect(screen.getByRole('heading', { name: /State Schema/i })).toBeInTheDocument();
    // service@version appears both in Schema-tab meta block and in incarnation header.
    expect(screen.getAllByText('v2.0.0').length).toBeGreaterThan(0);
  });

  it('фильтр top-level ключей в State работает', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations/svc-1',
        body: {
          name: 'svc-1',
          service: 'svc',
          service_version: 'main',
          state_schema_version: 1,
          covens: [],
          spec: {},
          state: {
            alpha: 1,
            beta: 'two',
            gamma: { x: 1 },
          },
          status: 'ready',
          created_by_aid: 'archon-x',
          created_at: '2026-05-20T10:00:00Z',
          updated_at: '2026-05-25T12:00:00Z',
        },
      },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/svc-1',
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'svc-1' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /^State/i }));

    // All three keys are visible. JsonKeyFilter renders keys as button-headers
    // with aria-expanded - a stable identifying property.
    const allKeyButtons = screen.getAllByRole('button', { expanded: false });
    const keyTexts = allKeyButtons.map((b) => b.textContent ?? '');
    expect(keyTexts.some((t) => t.includes('alpha'))).toBe(true);
    expect(keyTexts.some((t) => t.includes('beta'))).toBe(true);
    expect(keyTexts.some((t) => t.includes('gamma'))).toBe(true);

    // Filter by "alp" - leaves only alpha.
    const input = screen.getByLabelText('Фильтр по top-level ключам');
    await user.type(input, 'alp');

    const filtered = screen.getAllByRole('button', { expanded: false }).map((b) => b.textContent ?? '');
    expect(filtered.some((t) => t.includes('alpha'))).toBe(true);
    expect(filtered.every((t) => !t.includes('beta'))).toBe(true);
    expect(filtered.every((t) => !t.includes('gamma'))).toBe(true);
  });

  it('Trash2 на declared-host открывает RemoveHostModal, PATCH уходит только после подтверждения', async () => {
    let patchCount = 0;
    let lastUrl = '';
    let lastBody: unknown = null;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PATCH') {
        patchCount += 1;
        lastUrl = url;
        lastBody = init?.body ? JSON.parse(init.body as string) : null;
        return new Response(JSON.stringify({ name: 'redis-prod' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/v1/souls')) {
        return new Response(JSON.stringify({ items: [], offset: 0, limit: 200, total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          name: 'redis-prod',
          service: 'redis',
          service_version: 'v2.0.0',
          state_schema_version: 3,
          covens: ['prod'],
          spec: { hosts: [{ sid: 'agent-04.local', role: 'master' }] },
          state: {},
          status: 'ready',
          created_by_aid: 'archon-alice',
          created_at: '2026-05-20T10:00:00Z',
          updated_at: '2026-05-25T12:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

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
    await user.click(screen.getByRole('tab', { name: /Hosts/i }));

    // Click on Trash2 - opens modal, PATCH not sent yet.
    await user.click(screen.getByRole('button', { name: /Remove host agent-04.local/i }));
    expect(screen.getByTestId('remove-host-warning')).toBeInTheDocument();
    expect(patchCount).toBe(0);

    // Confirmation via checkbox -> confirm.
    await user.click(screen.getByLabelText('Подтвердить удаление хоста'));
    await user.click(screen.getByTestId('remove-host-confirm'));

    await waitFor(() => {
      expect(patchCount).toBe(1);
    });
    expect(lastUrl).toMatch(/\/v1\/incarnations\/redis-prod\/hosts/);
    expect(lastBody).toEqual({ mode: 'remove', hosts: [{ sid: 'agent-04.local' }] });
  });

  it('Overview summary-карточка кликает на Hosts tab и показывает per-host runtime data', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations/r-1',
        body: {
          name: 'r-1',
          service: 'r',
          service_version: 'main',
          state_schema_version: 1,
          covens: [],
          spec: {},
          state: {
            hosts: {
              'host-a': { role: 'master', pid: 1 },
            },
          },
          status: 'ready',
          created_by_aid: 'archon-x',
          created_at: '2026-05-20T10:00:00Z',
          updated_at: '2026-05-25T12:00:00Z',
        },
      },
      {
        method: 'GET',
        url: '/v1/souls',
        body: { items: [], offset: 0, limit: 200, total: 0 },
      },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/r-1',
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'r-1' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    // Click summary card "Hosts" (filter by summary button, not by tab).
    const summarySection = screen.getByRole('heading', { name: 'Data summary' }).parentElement!;
    const buttons = within(summarySection).getAllByRole('button');
    const hostsCard = buttons.find((b) => /Hosts/.test(b.textContent ?? ''))!;
    expect(hostsCard).toBeDefined();
    await user.click(hostsCard);

    // On the Hosts tab we see Per-host runtime data section with host-a.
    expect(screen.getByRole('heading', { name: /Per-host runtime data/i })).toBeInTheDocument();
    expect(screen.getByText('host-a')).toBeInTheDocument();
  });

  it('History tab: apply_id рендерится ссылкой на /incarnations/:name/runs/:apply_id (НЕ /voyages/)', async () => {
    // More specific paths come FIRST (fetchMock matches the first match).
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations/inc-h/history',
        body: {
          items: [
            {
              history_id: 'hid-1',
              scenario: 'deploy',
              apply_id: '01VOYAGE000000000000001',
              changed_by_aid: 'archon-x',
              created_at: '2026-05-25T12:00:00Z',
            },
          ],
          offset: 0,
          limit: 50,
          total: 1,
        },
      },
      {
        method: 'GET',
        url: '/v1/incarnations/inc-h',
        body: {
          name: 'inc-h',
          service: 'svc',
          service_version: 'main',
          state_schema_version: 1,
          covens: [],
          spec: {},
          state: {},
          status: 'ready',
          created_by_aid: 'archon-x',
          created_at: '2026-05-20T10:00:00Z',
          updated_at: '2026-05-25T12:00:00Z',
        },
      },
      {
        method: 'GET',
        url: '/v1/souls',
        body: { items: [], offset: 0, limit: 200, total: 0 },
      },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/inc-h',
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'inc-h' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    // Find tab by role=tab + aria-selected=false, match by text History
    const tabs = screen.getAllByRole('tab');
    const historyTab = tabs.find((t) => /History/i.test(t.textContent ?? ''))!;
    expect(historyTab).toBeDefined();
    await user.click(historyTab);

    // apply_id - apply_run (create/rerun-last/operational scenario), NOT Voyage:
    // link leads to run-view of the incarnation, not to /voyages/:id.
    await waitFor(() => {
      const link = screen.getByTestId('history-apply-link-hid-1');
      expect(link).toBeInTheDocument();
      expect((link as HTMLAnchorElement).href).toContain('/incarnations/inc-h/runs/01VOYAGE000000000000001');
      expect((link as HTMLAnchorElement).href).not.toContain('/voyages/');
    }, { timeout: 3000 });
  });

  it('Overview показывает traits инкарнации (scalar + list) в meta-блоке', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations/redis-traits',
        body: {
          name: 'redis-traits',
          service: 'redis',
          service_version: 'main',
          state_schema_version: 1,
          covens: ['prod'],
          traits: { team: 'platform', tier: ['gold', 'critical'] },
          spec: {},
          state: {},
          status: 'ready',
          created_by_aid: 'archon-x',
          created_at: '2026-05-20T10:00:00Z',
          updated_at: '2026-05-25T12:00:00Z',
        },
      },
      { method: 'GET', url: '/v1/souls', body: { items: [], offset: 0, limit: 200, total: 0 } },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/redis-traits',
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'redis-traits' })).toBeInTheDocument();
    });

    // scalar-trait - chip team=platform.
    expect(screen.getByText('team=platform')).toBeInTheDocument();
    // list-trait - expanded via comma in one chip.
    expect(screen.getByText('tier=gold, critical')).toBeInTheDocument();
  });

  it('Overview graceful empty когда incarnation.traits отсутствует (не краш)', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations/no-traits',
        body: {
          name: 'no-traits',
          service: 'redis',
          service_version: 'main',
          state_schema_version: 1,
          covens: [],
          spec: {},
          state: {},
          status: 'ready',
          created_by_aid: 'archon-x',
          created_at: '2026-05-20T10:00:00Z',
          updated_at: '2026-05-25T12:00:00Z',
        },
      },
      { method: 'GET', url: '/v1/souls', body: { items: [], offset: 0, limit: 200, total: 0 } },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/no-traits',
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'no-traits' })).toBeInTheDocument();
    });

    // Traits section present, value is em-dash fallback, page does not crash.
    expect(screen.getByText('Traits')).toBeInTheDocument();
  });
});
