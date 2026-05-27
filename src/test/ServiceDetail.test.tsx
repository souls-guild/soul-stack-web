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
});
