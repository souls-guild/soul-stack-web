import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { RunDetail } from '../pages/incarnations/RunDetail';
import { installFetchMock, type FetchRoute } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

// The run page's Input block by the scenario's form (NIM-1175): which version's schema
// is asked for, what the page says about it, and how values of each shape read.

const APPLY_ID = '01RUN00000000000000000777';
const INC = 'dba-billing-df-dev';

const runBody = (serviceVersion?: string, scenario = 'create', status = 'success') => ({
  apply_id: APPLY_ID,
  scenario,
  status,
  started_at: '2026-11-04T10:00:00Z',
  ...(status === 'applying' ? {} : { finished_at: '2026-11-04T10:20:00Z' }),
  ...(serviceVersion ? { service_version: serviceVersion } : {}),
  input: {
    cloud_stand: 'cloud',
    owners: ['uuid-1:ivanov.i', 'uuid-2:petrova.a'],
    replicas_per_master: 2,
    dragonfly_flags: { dbnum: '16' },
    users: [
      { name: 'billing_app', perms: '~billing:* +@read', state: 'on', password: '***MASKED***' },
      { name: 'legacy', perms: '~old:*', state: 'off', password: '***MASKED***' },
    ],
    tls: true,
    legacy_key: 'kept',
  },
  hosts: [{ sid: 'host-a.local', status: 'success', passage: 0, attempt: 1, cancel_requested: false }],
});

const scenarios = (label: string) => ({
  service: 'dragonfly',
  scenarios: [
    {
      name: 'create',
      kind: 'lifecycle',
      input_schema: {
        cloud_stand: { type: 'string', description: 'The WB Cloud stand the machines are ordered on.' },
        owners: { type: 'array', items: { type: 'string' } },
        environment_logical: { type: 'string' },
        replicas_per_master: { type: 'integer', default: 2 },
        dragonfly_flags: { type: 'object', default: {} },
        users: {
          type: 'array',
          items: { type: 'object', properties: { name: {}, perms: {}, state: {} } },
        },
        tls: { type: 'boolean' },
      },
      form: {
        sections: [
          {
            key: 'contacts',
            title: label,
            fields: [
              { name: 'cloud_stand', label: 'Cloud stand' },
              { name: 'owners', label: 'Owners' },
              { name: 'environment_logical', label: 'Logical environment' },
            ],
          },
          {
            key: 'dragonfly',
            title: 'DragonFly',
            fields: [
              { name: 'replicas_per_master', label: 'Replicas' },
              { name: 'dragonfly_flags', label: 'Flags' },
              { name: 'tls', label: 'TLS' },
            ],
          },
          { key: 'users', title: 'Users', fields: [{ name: 'users', label: 'ACL users' }] },
        ],
      },
    },
  ],
});

const incarnation = { name: INC, id: INC, service: 'dragonfly', service_version: 'v1.5.0', status: 'ready' };

function mount(routes: FetchRoute[]) {
  installFetchMock(routes);
  renderWithProviders(
    <Routes>
      <Route path="/incarnations/:name/runs/:applyId" element={<RunDetail />} />
    </Routes>,
    `/incarnations/${INC}/runs/${APPLY_ID}`,
  );
}

function scenarioRequests(): string[] {
  return vi
    .mocked(fetch)
    .mock.calls.map(([u]) => String(u))
    .filter((u) => u.startsWith('/v1/services/'));
}

const runRoute = (serviceVersion?: string, scenario?: string, status?: string): FetchRoute => ({
  method: 'GET',
  url: `/v1/incarnations/${INC}/runs/${APPLY_ID}`,
  body: runBody(serviceVersion, scenario, status),
});
const incRoute: FetchRoute = { method: 'GET', url: new RegExp(`^/v1/incarnations/${INC}$`), body: incarnation };

describe('RunInputView', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it("reads the run's input by the form of the version the run ran on", async () => {
    mount([
      runRoute('v1.4.0'),
      incRoute,
      { method: 'GET', url: '/v1/services/dragonfly/scenarios?ref=v1.4.0', body: scenarios('Contacts at v1.4.0') },
      { method: 'GET', url: '/v1/services/dragonfly/scenarios?ref=v1.5.0', body: scenarios('Contacts at v1.5.0') },
    ]);

    await waitFor(() => expect(screen.getByTestId('run-input-source')).toHaveAttribute('data-source', 'run'));
    expect(screen.getByTestId('run-input-source')).toHaveTextContent('v1.4.0');
    expect(scenarioRequests()).toEqual(['/v1/services/dragonfly/scenarios?ref=v1.4.0']);

    const contacts = screen.getByTestId('run-input-group-contacts');
    expect(contacts).toHaveTextContent('Contacts at v1.4.0');
    const stand = within(contacts).getByTestId('run-input-row-cloud_stand');
    expect(stand).toHaveTextContent('Cloud stand');
    expect(stand).toHaveTextContent('cloud_stand');
    expect(within(stand).getByTitle('The WB Cloud stand the machines are ordered on.')).toBeInTheDocument();
    expect(within(contacts).getByTestId('run-input-row-owners')).toHaveTextContent('uuid-2:petrova.a');
    expect(
      within(within(contacts).getByTestId('run-input-row-environment_logical')).getByTestId('run-input-unset'),
    ).toBeInTheDocument();

    const df = screen.getByTestId('run-input-group-dragonfly');
    expect(within(within(df).getByTestId('run-input-row-replicas_per_master')).getByTestId('run-input-default')).toBeInTheDocument();
    const flags = within(df).getByTestId('run-input-row-dragonfly_flags');
    expect(within(flags).queryByTestId('run-input-default')).not.toBeInTheDocument();
    expect(within(flags).getByRole('cell', { name: 'dbnum' })).toBeInTheDocument();
    expect(within(df).getByTestId('run-input-row-tls')).toHaveTextContent('yes');

    const users = within(screen.getByTestId('run-input-group-users')).getByRole('table');
    expect(within(users).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'name',
      'perms',
      'state',
      'password',
    ]);
    expect(within(users).getAllByTestId('run-input-masked')).toHaveLength(2);
    expect(users).not.toHaveTextContent('***MASKED***');

    expect(screen.getByTestId('run-input-group-__unknown')).toHaveTextContent('legacy_key');
  });

  it("asks for the incarnation's current version when the run recorded none, and says so", async () => {
    mount([
      runRoute(),
      incRoute,
      { method: 'GET', url: '/v1/services/dragonfly/scenarios?ref=v1.5.0', body: scenarios('Contacts at v1.5.0') },
    ]);
    await waitFor(() => expect(screen.getByTestId('run-input-source')).toHaveAttribute('data-source', 'current'));
    expect(screen.getByTestId('run-input-source')).toHaveTextContent('v1.5.0');
    expect(screen.getByTestId('run-input-group-contacts')).toHaveTextContent('Contacts at v1.5.0');
  });

  it('a run still going reads by the current version and says it is still going', async () => {
    mount([
      runRoute(undefined, 'create', 'applying'),
      incRoute,
      { method: 'GET', url: '/v1/services/dragonfly/scenarios?ref=v1.5.0', body: scenarios('Contacts at v1.5.0') },
    ]);
    await waitFor(() => expect(screen.getByTestId('run-input-source')).toHaveAttribute('data-source', 'live'));
    expect(screen.getByTestId('run-input-source')).toHaveTextContent('v1.5.0');
    expect(screen.getByTestId('run-input-group-contacts')).toHaveTextContent('Contacts at v1.5.0');
  });

  it("a run still going that already names its version reads by it, not by 'still going'", async () => {
    mount([
      runRoute('v1.4.0', 'create', 'applying'),
      incRoute,
      { method: 'GET', url: '/v1/services/dragonfly/scenarios?ref=v1.4.0', body: scenarios('Contacts at v1.4.0') },
      { method: 'GET', url: '/v1/services/dragonfly/scenarios?ref=v1.5.0', body: scenarios('Contacts at v1.5.0') },
    ]);
    await waitFor(() => expect(screen.getByTestId('run-input-source')).toHaveAttribute('data-source', 'run'));
    expect(screen.getByTestId('run-input-group-contacts')).toHaveTextContent('Contacts at v1.4.0');
  });

  it("falls back to the current version when the run's ref no longer resolves", async () => {
    mount([
      runRoute('v1.4.0'),
      incRoute,
      { method: 'GET', url: '/v1/services/dragonfly/scenarios?ref=v1.4.0', status: 502, body: { title: 'bad gateway' } },
      { method: 'GET', url: '/v1/services/dragonfly/scenarios?ref=v1.5.0', body: scenarios('Contacts at v1.5.0') },
    ]);
    await waitFor(() => expect(screen.getByTestId('run-input-source')).toHaveAttribute('data-source', 'fallback'));
    const source = screen.getByTestId('run-input-source');
    expect(source).toHaveTextContent('v1.4.0');
    expect(source).toHaveTextContent('v1.5.0');
    expect(screen.getByTestId('run-input-group-contacts')).toHaveTextContent('Contacts at v1.5.0');
  });

  it('shows the input by key when the scenario is not in the schema list, without asking another version', async () => {
    mount([
      runRoute('v1.4.0', 'upgrade_to_v2'),
      incRoute,
      { method: 'GET', url: '/v1/services/dragonfly/scenarios?ref=v1.4.0', body: scenarios('Contacts') },
      { method: 'GET', url: '/v1/services/dragonfly/scenarios?ref=v1.5.0', body: scenarios('Contacts') },
    ]);
    await waitFor(() => expect(screen.getByTestId('run-input-source')).toHaveAttribute('data-source', 'none'));
    // The fallback is for a ref that does not resolve, not for a scenario the version lacks.
    expect(scenarioRequests()).toEqual(['/v1/services/dragonfly/scenarios?ref=v1.4.0']);
    const group = screen.getByTestId('run-input-group-input');
    expect(within(group).getByTestId('run-input-row-cloud_stand')).toHaveTextContent('cloud');
    expect(screen.queryByTestId('run-input-group-contacts')).not.toBeInTheDocument();
  });

  it('toggles to the raw JSON and back', async () => {
    mount([runRoute('v1.4.0')]);
    await waitFor(() => expect(screen.getByTestId('run-input-source')).toHaveAttribute('data-source', 'none'));
    fireEvent.click(screen.getByTestId('run-input-mode-json'));
    const section = screen.getByTestId('run-input-section');
    expect(section).toHaveTextContent('"replicas_per_master": 2');
    expect(section).toHaveTextContent('***MASKED***');
    expect(screen.queryByTestId('run-input-groups')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('run-input-mode-fields'));
    expect(screen.getByTestId('run-input-groups')).toBeInTheDocument();
  });
});
