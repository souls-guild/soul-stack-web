import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { ServiceDetail } from '../pages/services/ServiceDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const SAMPLE = {
  name: 'redis',
  git: 'https://git.example.com/services/redis.git',
  ref: 'v2.0.0',
  refresh: '5m',
  created_by_aid: 'archon-bootstrap',
  updated_by_aid: 'archon-alice',
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
};

const INCS = {
  items: [
    {
      name: 'redis-prod',
      service: 'redis',
      service_version: 'v2.0.0',
      state_schema_version: 3,
      covens: ['prod'],
      status: 'ready',
      created_by_aid: 'archon-alice',
      created_at: '2026-04-15T00:00:00Z',
      updated_at: '2026-05-15T00:00:00Z',
    },
  ],
  offset: 0,
  limit: 200,
  total: 1,
};

describe('ServiceDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит детали из /v1/services/{name}', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/services/redis', body: SAMPLE },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/services/:name" element={<ServiceDetail />} />
      </Routes>,
      '/services/redis',
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'redis' })).toBeInTheDocument();
    });
    // git-url появляется в нескольких местах (meta + overview-блок) — проверяем >=1.
    expect(
      screen.getAllByText((_, el) =>
        el?.textContent === 'https://git.example.com/services/redis.git',
      ).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('таб Scenarios рендерит flat-map input_schema (новая backend-shape)', async () => {
    installFetchMock([
      // Более специфичный URL — первым (fetchMock берёт первый startsWith-match).
      {
        method: 'GET',
        url: '/v1/services/redis/scenarios',
        body: {
          service: 'redis',
          ref: 'v2.0.0',
          scenarios: [
            {
              name: 'create',
              kind: 'lifecycle',
              path: 'scenario/create/main.yml',
              description: 'Создаёт redis incarnation',
              input_schema: {
                greeting: {
                  type: 'string',
                  description: 'Приветственная строка',
                  required: true,
                },
                replicas: {
                  type: 'integer',
                  description: 'Кол-во реплик',
                },
              },
            },
          ],
        },
      },
      { method: 'GET', url: '/v1/services/redis', body: SAMPLE },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/services/:name" element={<ServiceDetail />} />
      </Routes>,
      '/services/redis',
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'redis' })).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Scenarios/i }));
    await waitFor(() => {
      expect(screen.getByText('create')).toBeInTheDocument();
    });
    // input fields summary — имена полей через запятую.
    expect(screen.getByText(/greeting, replicas/)).toBeInTheDocument();
    expect(screen.getByText('Создаёт redis incarnation')).toBeInTheDocument();
  });

  it('таб Scenarios: пустой каталог → empty-state без crash', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/services/redis/scenarios',
        body: { service: 'redis', ref: 'v2.0.0', scenarios: [] },
      },
      { method: 'GET', url: '/v1/services/redis', body: SAMPLE },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/services/:name" element={<ServiceDetail />} />
      </Routes>,
      '/services/redis',
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'redis' })).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Scenarios/i }));
    await waitFor(() => {
      expect(screen.getByText(/В каталоге пока нет сценариев/)).toBeInTheDocument();
    });
  });

  it('git-link: http(s) git-url кликабелен (href без .git-суффикса)', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/services/redis', body: SAMPLE },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/services/:name" element={<ServiceDetail />} />
      </Routes>,
      '/services/redis',
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'redis' })).toBeInTheDocument());
    const metaLink = screen.getByTestId('svc-git-link-meta');
    expect(metaLink).toHaveAttribute('href', 'https://git.example.com/services/redis');
    expect(metaLink).toHaveAttribute('target', '_blank');
  });

  it('git-link: non-http git (ssh) не кликабелен', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/services/redis',
        body: { ...SAMPLE, git: 'git@git.example.com:services/redis.git' },
      },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/services/:name" element={<ServiceDetail />} />
      </Routes>,
      '/services/redis',
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'redis' })).toBeInTheDocument());
    expect(screen.queryByTestId('svc-git-link-meta')).not.toBeInTheDocument();
  });

  it('таб Schema рендерит state_schema_version + поля + миграции', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/services/redis/state-schema',
        body: {
          service: 'redis',
          ref: 'v2.0.0',
          state_schema_version: 3,
          schema: {
            type: 'object',
            required: ['redis_version'],
            properties: {
              redis_version: { type: 'string' },
              maxmemory: { type: 'integer' },
            },
          },
          migrations: [{ from: 2, to: 3, path: 'migrations/002_to_003.yml' }],
        },
      },
      { method: 'GET', url: '/v1/services/redis', body: SAMPLE },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/services/:name" element={<ServiceDetail />} />
      </Routes>,
      '/services/redis',
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'redis' })).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Schema/i }));
    await waitFor(() => {
      expect(screen.getByTestId('svc-schema-section')).toBeInTheDocument();
    });
    expect(screen.getByText('redis_version')).toBeInTheDocument();
    expect(screen.getByText('migrations/002_to_003.yml')).toBeInTheDocument();
  });

  it('таб Schema: endpoint 404 → graceful degraded-плейсхолдер', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/services/redis/state-schema',
        status: 404,
        body: { title: 'not found', detail: 'no such endpoint' },
      },
      { method: 'GET', url: '/v1/services/redis', body: SAMPLE },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/services/:name" element={<ServiceDetail />} />
      </Routes>,
      '/services/redis',
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'redis' })).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Schema/i }));
    await waitFor(() => {
      expect(screen.getByTestId('svc-schema-degraded')).toBeInTheDocument();
    });
  });

  it('таб Incarnations подгружает /v1/incarnations?service=redis', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/services/redis', body: SAMPLE },
      { method: 'GET', url: '/v1/incarnations', body: INCS },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/services/:name" element={<ServiceDetail />} />
      </Routes>,
      '/services/redis',
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'redis' })).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Incarnations/i }));
    await waitFor(() => {
      expect(screen.getByText('redis-prod')).toBeInTheDocument();
    });
  });

  it('таб Dependencies рендерит destiny с ref', async () => {
    installFetchMock([
      // /dependencies — специфичнее /v1/services/redis → первым
      {
        method: 'GET',
        url: '/v1/services/redis/dependencies',
        body: {
          service: 'redis',
          ref: 'v2.0.0',
          destiny: [
            { name: 'base-linux', ref: 'v1.3.0' },
            { name: 'firewall', ref: 'main', git: 'https://git.example.com/firewall.git' },
          ],
          modules: [{ name: 'wb.redis-failover', ref: 'v0.9.0' }],
        },
      },
      { method: 'GET', url: '/v1/services/redis', body: SAMPLE },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/services/:name" element={<ServiceDetail />} />
      </Routes>,
      '/services/redis',
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'redis' })).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Dependencies|Зависимости/i }));
    await waitFor(() => {
      expect(screen.getByTestId('svc-deps-section')).toBeInTheDocument();
    });
    expect(screen.getByText('base-linux')).toBeInTheDocument();
    expect(screen.getByText('v1.3.0')).toBeInTheDocument();
    expect(screen.getByText('https://git.example.com/firewall.git')).toBeInTheDocument();
    expect(screen.getByText('wb.redis-failover')).toBeInTheDocument();
  });

  it('таб Dependencies: пустой destiny + пустые modules → empty-state без crash', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/services/redis/dependencies',
        body: { service: 'redis', ref: 'v2.0.0', destiny: [], modules: [] },
      },
      { method: 'GET', url: '/v1/services/redis', body: SAMPLE },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/services/:name" element={<ServiceDetail />} />
      </Routes>,
      '/services/redis',
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'redis' })).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Dependencies|Зависимости/i }));
    await waitFor(() => {
      expect(screen.getByTestId('svc-deps-section')).toBeInTheDocument();
    });
    expect(screen.getByText(/Нет destiny-зависимостей|No destiny/i)).toBeInTheDocument();
    expect(screen.getByText(/Нет custom-модулей|No custom/i)).toBeInTheDocument();
  });
});
