import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { IncarnationsList } from '../pages/incarnations/IncarnationsList';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

describe('IncarnationsList', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  it('renders the heading and list from /v1/incarnations', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations',
        body: {
          items: [
            {
              id: 'redis-prod',
              service: 'redis',
              service_version: 'v2.0.0',
              state_schema_version: 3,
              covens: ['prod', 'redis-prod'],
              status: 'ready',
              created_by_aid: 'archon-alice',
              created_at: '2026-05-25T10:00:00Z',
              updated_at: '2026-05-25T12:00:00Z',
            },
            {
              id: 'postgres-stage',
              service: 'postgres',
              service_version: 'main',
              state_schema_version: 1,
              covens: ['stage'],
              status: 'drift',
              created_by_aid: 'archon-bob',
              created_at: '2026-05-20T10:00:00Z',
              updated_at: '2026-05-25T11:30:00Z',
            },
          ],
          offset: 0,
          limit: 100,
          total: 2,
        },
      },
    ]);

    renderWithProviders(<IncarnationsList />, '/incarnations');

    expect(screen.getByRole('heading', { name: /Incarnations/i })).toBeInTheDocument();
    await waitFor(() => {
      // Link to incarnation - the only role=link with this name (name same as coven-tag -> badge is not a link).
      expect(screen.getByRole('link', { name: 'redis-prod' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'postgres-stage' })).toBeInTheDocument();
    });
  });

  it('shows empty-state when the list is empty', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations',
        body: { items: [], offset: 0, limit: 100, total: 0 },
      },
    ]);
    renderWithProviders(<IncarnationsList />, '/incarnations');
    await waitFor(() => {
      expect(screen.getByText(/matched the filter/i)).toBeInTheDocument();
    });
  });

  it('passes server-side coven=<x> to the /v1/incarnations request', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(urlStr);
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 100, total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(<IncarnationsList />, '/incarnations');

    const user = userEvent.setup();
    const covenInput = await screen.findByPlaceholderText(/prod \/ staging/i);
    await user.type(covenInput, 'prod');

    await waitFor(() => {
      expect(calls.some((u) => u.includes('coven=prod'))).toBe(true);
    });
  });

  it('inline-error on an invalid coven label (does not send a request)', async () => {
    let called = 0;
    vi.stubGlobal('fetch', async () => {
      called += 1;
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 100, total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(<IncarnationsList />, '/incarnations');

    const user = userEvent.setup();
    const covenInput = await screen.findByPlaceholderText(/prod \/ staging/i);
    // Roll back to initial call with empty coven.
    await waitFor(() => expect(called).toBeGreaterThanOrEqual(1));
    const initial = called;
    await user.type(covenInput, 'Prod-Bad!');
    expect(await screen.findByText(/Invalid coven label/i)).toBeInTheDocument();
    // No re-request with an invalid value was made.
    expect(called).toBe(initial);
  });

  // -- Guard tests: clickable links --------------------------------------

  it('[LINKS] service name renders as a link to /services/:name', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations',
        body: {
          items: [
            {
              id: 'redis-prod',
              service: 'redis',
              service_version: 'v2.0.0',
              state_schema_version: 3,
              covens: ['prod'],
              status: 'ready',
              created_by_aid: 'archon-alice',
              created_at: '2026-05-25T10:00:00Z',
              updated_at: '2026-05-25T12:00:00Z',
            },
            {
              id: 'postgres-stage',
              service: 'postgres',
              service_version: 'main',
              state_schema_version: 1,
              covens: ['stage'],
              status: 'drift',
              created_by_aid: 'archon-bob',
              created_at: '2026-05-20T10:00:00Z',
              updated_at: '2026-05-25T11:30:00Z',
            },
          ],
          offset: 0,
          limit: 100,
          total: 2,
        },
      },
    ]);
    renderWithProviders(<IncarnationsList />, '/incarnations');

    await waitFor(() => expect(screen.getByRole('link', { name: 'redis-prod' })).toBeInTheDocument());

    // Service names are links to /services/:name.
    const redisLink = screen.getByRole('link', { name: 'redis' });
    expect(redisLink).toHaveAttribute('href', '/services/redis');

    const postgresLink = screen.getByRole('link', { name: 'postgres' });
    expect(postgresLink).toHaveAttribute('href', '/services/postgres');
  });

  it('[LINKS] version suffix (@v2.0.0) stays text, not a link', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations',
        body: {
          items: [
            {
              id: 'redis-prod',
              service: 'redis',
              service_version: 'v2.0.0',
              state_schema_version: 3,
              covens: ['prod'],
              status: 'ready',
              created_by_aid: 'archon-alice',
              created_at: '2026-05-25T10:00:00Z',
              updated_at: '2026-05-25T12:00:00Z',
            },
          ],
          offset: 0,
          limit: 100,
          total: 1,
        },
      },
    ]);
    renderWithProviders(<IncarnationsList />, '/incarnations');

    await waitFor(() => expect(screen.getByRole('link', { name: 'redis-prod' })).toBeInTheDocument());

    // Version is plain text, not a link.
    expect(screen.getByText('@v2.0.0')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /@v2\.0\.0/ })).not.toBeInTheDocument();
  });

  it('[LINKS] empty list — no service links', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations',
        body: { items: [], offset: 0, limit: 100, total: 0 },
      },
    ]);
    renderWithProviders(<IncarnationsList />, '/incarnations');

    await waitFor(() => expect(screen.getByText(/matched the filter/i)).toBeInTheDocument());

    // No links to /services/*.
    expect(screen.queryByRole('link', { name: /redis|postgres/i })).not.toBeInTheDocument();
  });

  it('Traits column renders chips and a graceful "—" when traits are absent', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations',
        body: {
          items: [
            {
              id: 'redis-prod',
              service: 'redis',
              service_version: 'v2.0.0',
              state_schema_version: 3,
              covens: ['prod'],
              traits: { team: 'platform' },
              status: 'ready',
              created_by_aid: 'archon-alice',
              created_at: '2026-05-25T10:00:00Z',
              updated_at: '2026-05-25T12:00:00Z',
            },
            {
              id: 'postgres-stage',
              service: 'postgres',
              service_version: 'main',
              state_schema_version: 1,
              covens: ['stage'],
              status: 'drift',
              created_by_aid: 'archon-bob',
              created_at: '2026-05-20T10:00:00Z',
              updated_at: '2026-05-25T11:30:00Z',
            },
          ],
          offset: 0,
          limit: 100,
          total: 2,
        },
      },
    ]);

    renderWithProviders(<IncarnationsList />, '/incarnations');

    await waitFor(() => expect(screen.getByRole('link', { name: 'redis-prod' })).toBeInTheDocument());

    // Inside the table: one chip cell + one chip option of the multiselect - both
    // are textually equal to 'team=platform', so we check within the table scope.
    const table = screen.getByRole('table');
    expect(within(table).getByText('team=platform')).toBeInTheDocument();
    // postgres-stage without traits - there is at least one em-dash fallback (page does not crash).
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('coven+traits multiselect filters client-side by AND', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations',
        body: {
          items: [
            {
              id: 'redis-prod',
              service: 'redis',
              service_version: 'v2.0.0',
              state_schema_version: 3,
              covens: ['prod'],
              traits: { team: 'platform' },
              status: 'ready',
              created_by_aid: 'archon-alice',
              created_at: '2026-05-25T10:00:00Z',
              updated_at: '2026-05-25T12:00:00Z',
            },
            {
              id: 'redis-stage',
              service: 'redis',
              service_version: 'v2.0.0',
              state_schema_version: 3,
              covens: ['stage'],
              traits: { team: 'platform' },
              status: 'ready',
              created_by_aid: 'archon-alice',
              created_at: '2026-05-25T10:00:00Z',
              updated_at: '2026-05-25T12:00:00Z',
            },
            {
              id: 'postgres-stage',
              service: 'postgres',
              service_version: 'main',
              state_schema_version: 1,
              covens: ['stage'],
              traits: { team: 'data' },
              status: 'drift',
              created_by_aid: 'archon-bob',
              created_at: '2026-05-20T10:00:00Z',
              updated_at: '2026-05-25T11:30:00Z',
            },
          ],
          offset: 0,
          limit: 100,
          total: 3,
        },
      },
    ]);

    renderWithProviders(<IncarnationsList />, '/incarnations');

    await waitFor(() => expect(screen.getByRole('link', { name: 'redis-prod' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'redis-stage' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'postgres-stage' })).toBeInTheDocument();

    const user = userEvent.setup();

    // Select coven=stage (multiselect) - leaves redis-stage + postgres-stage.
    await user.click(screen.getByRole('button', { name: 'stage' }));
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'redis-prod' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'redis-stage' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'postgres-stage' })).toBeInTheDocument();

    // + trait team=platform (AND) - leaves only redis-stage.
    await user.click(screen.getByRole('button', { name: 'team=platform' }));
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'postgres-stage' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'redis-stage' })).toBeInTheDocument();

    // Reset filter - returns all three.
    await user.click(screen.getByText('Clear filter'));
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'redis-prod' })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'postgres-stage' })).toBeInTheDocument();
  });

  it('drops the Last drift check column but keeps the drift STATUS (NIM-445 boundary)', async () => {
    // Rows are verbatim /v1/incarnations items from a live keeper. The first
    // still carries last_drift_check_at, so the missing column is the doing of
    // the component and not of a fixture that quietly stopped sending it.
    //
    // The second row pins the other side of the ticket. `drift` is a status the
    // backend assigns and the operator must keep seeing; only the check that
    // used to produce it went. Whether the status outlives its producer is
    // decided in NIM-446 — until then removing it here would be a second,
    // unrequested change hiding inside this one.
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/incarnations',
        body: {
          items: [
            {
              id: 'nim445-fixture',
              service: 'hello-world',
              service_version: 'main',
              state_schema_version: 1,
              covens: ['dev'],
              status: 'ready',
              created_by_aid: 'archon-alice',
              created_at: '2026-08-05T09:30:32.8937Z',
              updated_at: '2026-08-05T09:30:32.8937Z',
              last_drift_check_at: '2026-08-05T10:14:01.576315Z',
              last_drift_summary: {
                hosts_clean: 1,
                hosts_drifted: 1,
                hosts_failed: 0,
                hosts_unsupported: 0,
                scanned_at: '0001-01-01T00:00:00Z',
                total_hosts: 0,
              },
            },
            {
              id: 'postgres-stage',
              service: 'postgres',
              service_version: 'main',
              state_schema_version: 1,
              covens: ['stage'],
              status: 'drift',
              created_by_aid: 'archon-bob',
              created_at: '2026-05-20T10:00:00Z',
              updated_at: '2026-05-25T11:30:00Z',
            },
          ],
          offset: 0,
          limit: 100,
          total: 2,
        },
      },
    ]);

    renderWithProviders(<IncarnationsList />, '/incarnations');

    await waitFor(() => expect(screen.getByRole('link', { name: 'nim445-fixture' })).toBeInTheDocument());

    const table = screen.getByRole('table');

    // Column identity is asserted by SHAPE, not by the rendered label. Two
    // reasons, both of which let a verbatim resurrection of this column through
    // an earlier version of this test:
    //   - A header reads t('incarnations:colLastDrift'), and with the key
    //     deleted i18next renders the bare key `colLastDrift` — which no regex
    //     built from the English wording matches.
    //   - The cell read formatTimeAgo(row.last_drift_check_at), which returns
    //     "29m ago" and never the timestamp, so watching for the ISO string
    //     was an assertion that could not fail.
    // A count survives both: a seventh column is a seventh column whatever it
    // renders and whatever it is called.
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent?.trim() ?? '');
    expect(headers).toEqual(['Label', 'Service', 'Status', 'Covens', 'Traits', 'Created ↓']);
    for (const row of within(table).getAllByRole('row').slice(1)) {
      expect(within(row).getAllByRole('cell')).toHaveLength(headers.length);
    }

    // No drift-check control anywhere on the page, under either the translated
    // label or the bare key. This page has no write-tracking fixture, so an
    // affordance is caught by its presence rather than by the request it fires.
    for (const button of screen.getAllByRole('button')) {
      expect(button.textContent ?? '').not.toMatch(/drift/i);
    }

    // Still there: the status badge and its filter option.
    expect(within(table).getByText('drift')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'drift' })).toBeInTheDocument();
  });
});
