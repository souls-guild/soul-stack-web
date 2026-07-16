import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from './renderWithProviders';
import { SchemaTab } from '../pages/incarnations/SchemaTab';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const REPLY = {
  service: 'redis',
  ref: 'main',
  state_schema_version: 2,
  schema: {
    type: 'object',
    required: ['redis_version'],
    properties: {
      redis_version: { type: 'string' },
      maxmemory: { type: 'integer' },
    },
  },
  migrations: [
    { from: 1, to: 2, path: 'migrations/001_to_002.yml' },
  ],
};

describe('SchemaTab', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('фетчит state-schema и рендерит поля + миграции', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/services/redis/state-schema', body: REPLY },
    ]);
    renderWithProviders(
      <SchemaTab serviceName="redis" serviceVersion="main" stateSchemaVersion={2} />,
      '/incarnations/x',
    );
    await waitFor(() => {
      // schema fields
      expect(screen.getByText('redis_version')).toBeInTheDocument();
      expect(screen.getByText('maxmemory')).toBeInTheDocument();
    });
    // required flag
    expect(screen.getByText('да')).toBeInTheDocument();
    // from->to migration
    expect(screen.getByText('migrations/001_to_002.yml')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
  });

  it('endpoint 404 → graceful placeholder', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/services/redis/state-schema',
        status: 404,
        body: { title: 'not found', detail: 'no such endpoint' },
      },
    ]);
    renderWithProviders(
      <SchemaTab serviceName="redis" serviceVersion="main" stateSchemaVersion={1} />,
      '/incarnations/x',
    );
    await waitFor(() => {
      expect(screen.getByText(/Детальная state-schema по этому сервису сейчас недоступна/)).toBeInTheDocument();
    });
  });

  it('schema без декларации → empty-state структуры, но миграции отдельно', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/services/hello/state-schema',
        body: { service: 'hello', ref: 'main', state_schema_version: 1, migrations: [] },
      },
    ]);
    renderWithProviders(
      <SchemaTab serviceName="hello" serviceVersion="main" stateSchemaVersion={1} />,
      '/incarnations/x',
    );
    await waitFor(() => {
      expect(screen.getByText(/Структура state не задекларирована/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Миграций нет/)).toBeInTheDocument();
  });
});
