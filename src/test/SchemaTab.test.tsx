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

  it('fetches state-schema and renders fields + migrations', async () => {
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
    expect(screen.getByText('yes')).toBeInTheDocument();
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
      expect(screen.getByText(/Detailed state-schema for this service is currently unavailable/)).toBeInTheDocument();
    });
  });

  it('schema without declaration → empty-state structure, but migrations separately', async () => {
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
      expect(screen.getByText(/State structure is not declared/)).toBeInTheDocument();
    });
    expect(screen.getByText(/No migrations/)).toBeInTheDocument();
  });
});
