import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { ArchonsList } from '../pages/archons/ArchonsList';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const SAMPLE_LIST = {
  items: [
    {
      aid: 'archon-bootstrap',
      display_name: 'Bootstrap Archon',
      auth_method: 'jwt',
      created_via: 'bootstrap',
      created_at: '2026-05-01T00:00:00Z',
      created_by_aid: null,
      revoked_at: null,
      bootstrap_initial: true,
    },
    {
      aid: 'archon-alice',
      display_name: 'Alice Ops',
      auth_method: 'jwt',
      created_via: 'user',
      created_at: '2026-05-10T10:00:00Z',
      created_by_aid: 'archon-bootstrap',
      revoked_at: null,
      bootstrap_initial: false,
    },
    {
      aid: 'archon-old',
      display_name: 'Old Ops',
      auth_method: 'jwt',
      created_via: 'ldap',
      created_at: '2026-04-01T00:00:00Z',
      created_by_aid: 'archon-bootstrap',
      revoked_at: '2026-05-20T00:00:00Z',
      bootstrap_initial: false,
    },
  ],
  offset: 0,
  limit: 50,
  total: 3,
};

describe('ArchonsList', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  it('renders the Archons table from GET /v1/operators', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: SAMPLE_LIST },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    await waitFor(() => {
      // AID is a link in the first column; in other rows archon-bootstrap
      // appears as created_by (mono-text). Count only links.
      expect(screen.getByRole('link', { name: 'archon-bootstrap' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'archon-alice' })).toBeInTheDocument();
    });
    // Badge initial for the bootstrap Archon.
    expect(screen.getByText('initial')).toBeInTheDocument();
  });

  it('renders a clickable AID link to detail', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: SAMPLE_LIST },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    await waitFor(() => {
      expect(screen.getByText('archon-alice')).toBeInTheDocument();
    });
    const link = screen.getByRole('link', { name: 'archon-alice' });
    expect(link).toHaveAttribute('href', '/archons/archon-alice');
  });

  it('auth_method + hide-revoked filters reach the query', async () => {
    let lastUrl = '';
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      lastUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(JSON.stringify(SAMPLE_LIST), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/Auth method/i), 'jwt');
    // Default: Hide revoked = ON -> revoked param is NOT passed (server-default
    // = active only). Uncheck the checkbox -> revoked=true should appear.
    await user.click(screen.getByLabelText(/Hide revoked/i));
    await waitFor(() => {
      expect(lastUrl).toMatch(/auth_method=jwt/);
      expect(lastUrl).toMatch(/revoked=true/);
    });
  });

  it('Hide revoked default ON: revoked Archon hidden + counter X of Y', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: SAMPLE_LIST },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'archon-alice' })).toBeInTheDocument();
    });
    // archon-old (revoked_at != null) is hidden by default.
    expect(screen.queryByRole('link', { name: 'archon-old' })).not.toBeInTheDocument();
    // Counter: 2 visible, 3 total.
    expect(screen.getByLabelText(/archons counter/i)).toHaveTextContent(/2.*3/);
  });

  it('Hide revoked OFF: revoked Archon visible with red chip + Revoke disabled', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: SAMPLE_LIST },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'archon-alice' })).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText(/Hide revoked/i));
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'archon-old' })).toBeInTheDocument();
    });
    // Chip "revoked" next to the aid.
    expect(screen.getByText('revoked')).toBeInTheDocument();
    // Revoke and Issue token for archon-old (last row in the table) - disabled.
    // testid is locale-stable (button label depends on the selected language).
    expect(screen.getByTestId('revoke-archon-old')).toBeDisabled();
    expect(screen.getByTestId('issue-token-archon-old')).toBeDisabled();
    // Counter: 3 of 3.
    expect(screen.getByLabelText(/archons counter/i)).toHaveTextContent(/3.*3/);
  });

  it('per-row Revoke via Modal → POST /v1/operators/{aid}/revoke', async () => {
    const calls: Array<{ url: string; method: string; body: string | null }> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : null;
      calls.push({ url, method, body });
      if (url.startsWith('/v1/operators') && method === 'GET') {
        return new Response(JSON.stringify(SAMPLE_LIST), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.match(/\/v1\/operators\/.+\/revoke/) && method === 'POST') {
        return new Response('', { status: 204 });
      }
      return new Response('{}', { status: 599 });
    });

    renderWithProviders(<ArchonsList />, '/archons');
    await waitFor(() => {
      // Hide revoked default ON -> archon-old is filtered out, 2 rows visible.
      expect(screen.getByTestId('revoke-archon-alice')).toBeInTheDocument();
    });
    const user = userEvent.setup();
    await user.click(screen.getByTestId('revoke-archon-alice'));
    // Modal should open with a title containing the AID.
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Revoke archon-alice/i })).toBeInTheDocument();
    });
    // Inside the Modal enter reason and submit.
    const textarea = screen.getByPlaceholderText(/employee offboarding/i);
    await user.type(textarea, 'key compromise');
    await user.click(screen.getByTestId('revoke-submit'));
    await waitFor(() => {
      expect(calls.some((c) => c.url === '/v1/operators/archon-alice/revoke' && c.method === 'POST')).toBe(true);
    });
    // Body contains reason without the aid field (path-param is the authority).
    const revokeCall = calls.find((c) => c.url === '/v1/operators/archon-alice/revoke');
    expect(revokeCall?.body).toContain('key compromise');
  });

  it('Revoke 409 (last cluster-admin) — pretty-error in Modal, Modal stays open', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.startsWith('/v1/operators') && method === 'GET') {
        return new Response(JSON.stringify(SAMPLE_LIST), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.match(/\/v1\/operators\/.+\/revoke/) && method === 'POST') {
        return new Response(
          JSON.stringify({
            type: 'https://soul-stack.io/errors/last-cluster-admin',
            title: 'Conflict',
            status: 409,
            detail: 'would lock out cluster',
          }),
          {
            status: 409,
            headers: { 'Content-Type': 'application/problem+json' },
          },
        );
      }
      return new Response('{}', { status: 599 });
    });

    renderWithProviders(<ArchonsList />, '/archons');
    await waitFor(() => {
      // Hide revoked default ON -> 2 visible rows (bootstrap, alice).
      expect(screen.getByTestId('revoke-archon-alice')).toBeInTheDocument();
    });
    const user = userEvent.setup();
    await user.click(screen.getByTestId('revoke-archon-alice'));
    await user.click(await screen.findByTestId('revoke-submit'));
    // Pretty-error visible in Modal; Modal does not close.
    expect(await screen.findByRole('alert')).toHaveTextContent(/last-?cluster-?admin|self-lockout|last Archon/i);
    expect(screen.getByRole('dialog', { name: /Revoke archon-alice/i })).toBeInTheDocument();
  });

  it('Create — POST /v1/operators returns jwt, renders JwtReveal', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: { items: [], offset: 0, limit: 50, total: 0 } },
      {
        method: 'POST',
        url: '/v1/operators',
        status: 201,
        body: {
          aid: 'archon-alice',
          display_name: 'Alice',
          created_at: '2026-05-26T10:00:00Z',
          created_by_aid: 'archon-bob',
          jwt: 'eyJ.payload.sig',
        },
      },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/alice@corp\.com/i), 'archon-alice');
    await user.type(screen.getByPlaceholderText(/Alice Ops/i), 'Alice');

    const createBtn = screen.getByRole('button', { name: /Create/i });
    expect(createBtn).not.toBeDisabled();
    await user.click(createBtn);

    await waitFor(() => {
      expect(screen.getByText(/JWT issued/i)).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('eyJ.payload.sig')).toBeInTheDocument();
  });

  it('inline pattern error on invalid AID', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: { items: [], offset: 0, limit: 50, total: 0 } },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    // Invalid AID: uppercase - violates ^[a-z0-9]...
    await user.type(screen.getByPlaceholderText(/alice@corp\.com/i), 'Alice!');
    expect(screen.getAllByText(/format:/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Create/i })).toBeDisabled();
  });

  it('empty display_name blocks submit, valid AID', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: { items: [], offset: 0, limit: 50, total: 0 } },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    // Valid AID, but display_name empty -> submit disabled.
    await user.type(screen.getByPlaceholderText(/alice@corp\.com/i), 'archon-alice');
    expect(screen.getByRole('button', { name: /Create/i })).toBeDisabled();
    // Filled display_name -> submit unlocked.
    await user.type(screen.getByPlaceholderText(/Alice Ops/i), 'Alice');
    expect(screen.getByRole('button', { name: /Create/i })).not.toBeDisabled();
  });

  it('display_name > 128 characters — inline error + submit disabled', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: { items: [], offset: 0, limit: 50, total: 0 } },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/alice@corp\.com/i), 'archon-alice');
    await user.type(screen.getByPlaceholderText(/Alice Ops/i), 'x'.repeat(129));
    expect(screen.getByText(/maximum 128 characters/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create/i })).toBeDisabled();
  });

  // --- Multi-select roles (extended payload {aid, display_name, roles[]}) ---

  const SAMPLE_ROLES = {
    items: [
      { name: 'cluster-admin', description: 'root', builtin: true, permissions: ['*'], operators: [] },
      { name: 'ops-viewer', description: 'read-only', builtin: false, permissions: ['*.read'], operators: [] },
      { name: 'release-engineer', description: 'release', builtin: false, permissions: ['incarnation.*'], operators: [] },
    ],
  };

  it('TestCreateArchon_WithRoles_SendsRolesInPayload', async () => {
    const calls: Array<{ url: string; method: string; body: string | null }> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : null;
      calls.push({ url, method, body });
      if (url.startsWith('/v1/operators') && method === 'GET') {
        return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith('/v1/roles') && method === 'GET') {
        return new Response(JSON.stringify(SAMPLE_ROLES), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/v1/operators' && method === 'POST') {
        return new Response(
          JSON.stringify({
            aid: 'archon-alice',
            display_name: 'Alice',
            created_at: '2026-05-27T10:00:00Z',
            created_by_aid: 'archon-bob',
            jwt: 'eyJ.payload.sig',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 599 });
    });

    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/alice@corp\.com/i), 'archon-alice');
    await user.type(screen.getByPlaceholderText(/Alice Ops/i), 'Alice');

    // Wait for select to fill with options.
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /add role/i })).not.toBeDisabled();
    });
    const rolesSelect = screen.getByRole('combobox', { name: /add role/i });
    await user.selectOptions(rolesSelect, 'ops-viewer');
    await user.selectOptions(rolesSelect, 'release-engineer');

    // Chips appeared.
    expect(screen.getByText('ops-viewer')).toBeInTheDocument();
    expect(screen.getByText('release-engineer')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/operators' && c.method === 'POST');
      expect(post).toBeDefined();
      const parsed = JSON.parse(post!.body ?? '{}') as { roles?: string[] };
      expect(parsed.roles).toEqual(['ops-viewer', 'release-engineer']);
    });
  });

  it('TestCreateArchon_NoRoles_OK', async () => {
    const calls: Array<{ url: string; method: string; body: string | null }> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : null;
      calls.push({ url, method, body });
      if (url.startsWith('/v1/operators') && method === 'GET') {
        return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith('/v1/roles') && method === 'GET') {
        return new Response(JSON.stringify(SAMPLE_ROLES), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/v1/operators' && method === 'POST') {
        return new Response(
          JSON.stringify({
            aid: 'archon-alice',
            display_name: 'Alice',
            created_at: '2026-05-27T10:00:00Z',
            created_by_aid: 'archon-bob',
            jwt: 'eyJ.payload.sig',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 599 });
    });

    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/alice@corp\.com/i), 'archon-alice');
    await user.type(screen.getByPlaceholderText(/Alice Ops/i), 'Alice');
    await user.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/operators' && c.method === 'POST');
      expect(post).toBeDefined();
      const parsed = JSON.parse(post!.body ?? '{}') as { roles?: string[] };
      // Without selection - field is either absent or an empty array (we don't send roles if empty).
      expect(parsed.roles === undefined || parsed.roles.length === 0).toBe(true);
    });
  });

  it('TestCreateArchon_UnknownRole_422', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.startsWith('/v1/operators') && method === 'GET') {
        return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith('/v1/roles') && method === 'GET') {
        return new Response(JSON.stringify(SAMPLE_ROLES), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/v1/operators' && method === 'POST') {
        return new Response(
          JSON.stringify({
            type: 'https://soul-stack.io/errors/validation-failed',
            title: 'Unprocessable Entity',
            status: 422,
            detail: 'unknown role: ops-viewer',
          }),
          { status: 422, headers: { 'Content-Type': 'application/problem+json' } },
        );
      }
      return new Response('{}', { status: 599 });
    });

    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/alice@corp\.com/i), 'archon-alice');
    await user.type(screen.getByPlaceholderText(/Alice Ops/i), 'Alice');
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /add role/i })).not.toBeDisabled();
    });
    await user.selectOptions(screen.getByRole('combobox', { name: /add role/i }), 'ops-viewer');
    await user.click(screen.getByRole('button', { name: /Create/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/422/);
    expect(alert).toHaveTextContent(/unknown role|validation/i);
  });

  it('Backend without roles support (404 on extended payload) — graceful degradation', async () => {
    let postCount = 0;
    const postBodies: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : null;
      if (url.startsWith('/v1/operators') && method === 'GET') {
        return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith('/v1/roles') && method === 'GET') {
        return new Response(JSON.stringify(SAMPLE_ROLES), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/v1/operators' && method === 'POST') {
        postCount += 1;
        postBodies.push(body ?? '');
        // First POST - with roles[] - backend doesn't support it yet: 404.
        if (postCount === 1) {
          return new Response(
            JSON.stringify({
              type: 'https://soul-stack.io/errors/not-found',
              title: 'Not Found',
              status: 404,
              detail: 'roles[] field not supported',
            }),
            { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
          );
        }
        // Second POST - fallback without roles[] - 201.
        return new Response(
          JSON.stringify({
            aid: 'archon-alice',
            display_name: 'Alice',
            created_at: '2026-05-27T10:00:00Z',
            created_by_aid: 'archon-bob',
            jwt: 'eyJ.payload.sig',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 599 });
    });

    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/alice@corp\.com/i), 'archon-alice');
    await user.type(screen.getByPlaceholderText(/Alice Ops/i), 'Alice');
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /add role/i })).not.toBeDisabled();
    });
    await user.selectOptions(screen.getByRole('combobox', { name: /add role/i }), 'ops-viewer');
    await user.click(screen.getByRole('button', { name: /Create/i }));

    // JWT rendered - Archon was created after all.
    await waitFor(() => {
      expect(screen.getByText(/JWT issued/i)).toBeInTheDocument();
    });
    // There were two POSTs: with roles and without.
    expect(postCount).toBe(2);
    expect(JSON.parse(postBodies[0])).toHaveProperty('roles');
    expect(JSON.parse(postBodies[1]).roles).toBeUndefined();
    // Hint to the user about unsupported.
    expect(screen.getByRole('status')).toHaveTextContent(/backend does not support/i);
  });

  // --- created_via column ---

  it('created_via is shown as a Badge in the table', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: SAMPLE_LIST },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'archon-alice' })).toBeInTheDocument();
    });
    // archon-alice (hide-revoked ON -> archon-old hidden):
    // bootstrap -> badge for archon-bootstrap, user -> badge for archon-alice
    expect(screen.getByTestId('created-via-archon-bootstrap')).toHaveTextContent('bootstrap');
    expect(screen.getByTestId('created-via-archon-alice')).toHaveTextContent('user');
    // archon-old hidden (hide-revoked ON by default)
    expect(screen.queryByTestId('created-via-archon-old')).not.toBeInTheDocument();
  });

  it('created_via=ldap is shown when hide-revoked is off', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: SAMPLE_LIST },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'archon-alice' })).toBeInTheDocument();
    });
    // Turn off hide-revoked -> archon-old visible
    await user.click(screen.getByLabelText(/Hide revoked/i));
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'archon-old' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('created-via-archon-old')).toHaveTextContent('ldap');
  });

  // --- AID pattern: new format ADR-014 amendment ---

  it.each([
    ['alice@corp.com', true],
    ['ops-bob', true],
    ['archon-alice', true],  // old format is also valid
    ['a1', true],             // minimum length 2
    ['user.name_42@example.org', true],
    ['BOB', false],           // uppercase - forbidden
    ['-x', false],            // leading dash - forbidden
    ['', false],              // empty - doesn't pass regex (length < 2)
    ['a', false],             // length 1 - below minimum
    ['Alice!', false],        // uppercase + special char
  ])('AID "%s" → valid=%s', async (aid, expectedValid) => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: { items: [], offset: 0, limit: 50, total: 0 } },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    const input = screen.getByPlaceholderText(/alice@corp\.com/i);
    if (aid.length > 0) {
      await user.type(input, aid);
    }
    const errorShown = screen.queryAllByText(/format:/i).length > 0;
    const btnDisabled = screen.getByRole('button', { name: /Create/i }).hasAttribute('disabled');
    if (expectedValid) {
      // Valid AID: no error hint; button may be disabled due to display_name
      expect(errorShown).toBe(false);
    } else {
      // Invalid AID with non-empty input: error + button disabled
      if (aid.length > 0) {
        expect(errorShown).toBe(true);
      }
      expect(btnDisabled).toBe(true);
    }
  });

  // --- Search in Archons list ---

  it('search by AID — filters client-side by aid', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: SAMPLE_LIST },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'archon-alice' })).toBeInTheDocument();
    });
    const searchInput = screen.getByPlaceholderText(/AID or name/i);
    await user.type(searchInput, 'alice');
    // Only alice visible, bootstrap hidden.
    expect(screen.getByRole('link', { name: 'archon-alice' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'archon-bootstrap' })).not.toBeInTheDocument();
    // Counter updated: "Found 1 of 2"
    expect(screen.getByLabelText(/archons counter/i)).toHaveTextContent(/1/);
  });

  it('search by display_name — filters client-side by display_name', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: SAMPLE_LIST },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'archon-bootstrap' })).toBeInTheDocument();
    });
    const searchInput = screen.getByPlaceholderText(/AID or name/i);
    // display_name = 'Bootstrap Archon'
    await user.type(searchInput, 'Bootstrap');
    expect(screen.getByRole('link', { name: 'archon-bootstrap' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'archon-alice' })).not.toBeInTheDocument();
  });

  it('empty search — shows all', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/operators', body: SAMPLE_LIST },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'archon-alice' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'archon-bootstrap' })).toBeInTheDocument();
    });
  });
});
