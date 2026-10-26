import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { AuthProvider } from '../hooks/AuthProvider';
import { ArchonsList } from '../pages/archons/ArchonsList';
import { ArchonDetail } from '../pages/archons/ArchonDetail';
import { tokenStore } from '../api/tokenStore';

interface Call {
  method: string;
  url: string;
  body?: unknown;
}
type Reply = { status: number; body?: unknown };

function op(over: Record<string, unknown>) {
  return {
    aid: 'ci-bot',
    display_name: 'CI bot',
    auth_method: 'jwt',
    created_via: 'user',
    created_at: '2026-10-01T00:00:00Z',
    created_by_aid: 'root',
    revoked_at: null,
    bootstrap_initial: false,
    ...over,
  };
}

const LIST = {
  items: [
    op({ aid: 'sd-gateway', display_name: 'SD gateway', owner_aid: 'alice' }),
    op({ aid: 'sd-dict', display_name: 'SD dictionary', owner_synod: 'dba' }),
    op({ aid: 'ci-bot', display_name: 'CI bot' }),
    op({ aid: 'alice', display_name: 'Alice', auth_method: 'ldap', created_via: 'ldap' }),
  ],
  offset: 0,
  limit: 50,
  total: 4,
};

const SYNODS = { items: [{ name: 'dba', description: '', builtin: false, operators: ['alice'], roles: [] }] };

function problem(status: number, type: string, detail: string): Reply {
  return { status, body: { type: `https://soul-stack.com/errors/${type}`, title: 'refused', status, detail } };
}

function mockFetch(handler: (c: Call) => Reply | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : input.toString();
      const call: Call = { method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      const r = handler(call) ?? fallback(call);
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
        status: r.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}

function fallback(c: Call): Reply {
  if (c.method === 'GET' && c.url.startsWith('/v1/roles')) return { status: 200, body: { items: [] } };
  if (c.method === 'GET' && c.url.startsWith('/v1/synods')) return { status: 200, body: SYNODS };
  if (c.method === 'GET' && c.url.startsWith('/v1/me/permissions')) {
    return { status: 200, body: { permissions: [{ resource: '*', action: '*', wildcard: true }] } };
  }
  if (c.url.startsWith('/v1/incarnations')) return { status: 200, body: { items: [], offset: 0, limit: 1, total: 0 } };
  if (c.url.startsWith('/auth/methods')) return { status: 200, body: {} };
  return { status: 599, body: { title: 'not mocked', detail: c.url } };
}

const listQuery = (calls: Call[]) =>
  calls.filter((c) => c.method === 'GET' && c.url.startsWith('/v1/operators?')).map((c) => new URLSearchParams(c.url.split('?')[1]));

const operatorsList = (c: Call): Reply | undefined =>
  c.method === 'GET' && (c.url === '/v1/operators' || c.url.startsWith('/v1/operators?')) ? { status: 200, body: LIST } : undefined;

describe('Archons list → owner', () => {
  beforeEach(() => tokenStore.clear());

  it('the Owner column: a person, a Synod, no owner, and — for an Archon that cannot have one', async () => {
    mockFetch(operatorsList);
    renderWithProviders(<ArchonsList />, '/archons');

    const person = await screen.findByTestId('owner-sd-gateway');
    expect(within(person).getByRole('link', { name: 'alice' })).toHaveAttribute('href', '/archons/alice');

    const synod = screen.getByTestId('owner-sd-dict');
    expect(within(synod).getByRole('link', { name: 'dba' })).toHaveAttribute('href', '/synods/dba');
    expect(synod).toHaveTextContent('Synod');

    expect(screen.getByTestId('owner-ci-bot')).toHaveTextContent('no owner');
    expect(screen.getByTestId('owner-alice')).toHaveTextContent('—');
    expect(screen.getByTestId('owner-alice')).not.toHaveTextContent('no owner');
  });

  it('the owner filter goes to the server as owner_synod / owner_aid', async () => {
    const calls = mockFetch(operatorsList);
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    await screen.findByTestId('owner-sd-gateway');
    expect(listQuery(calls)[0].get('owner_aid')).toBeNull();

    await user.selectOptions(screen.getByTestId('archon-filter-owner-kind'), 'synod');
    await user.type(screen.getByTestId('archon-filter-owner'), 'dba');
    await waitFor(() => {
      const qs = listQuery(calls).at(-1)!;
      expect(qs.get('owner_synod')).toBe('dba');
      expect(qs.get('owner_aid')).toBeNull();
    });

    await user.selectOptions(screen.getByTestId('archon-filter-owner-kind'), 'archon');
    await user.clear(screen.getByTestId('archon-filter-owner'));
    await user.type(screen.getByTestId('archon-filter-owner'), 'alice');
    await waitFor(() => {
      const qs = listQuery(calls).at(-1)!;
      expect(qs.get('owner_aid')).toBe('alice');
      expect(qs.get('owner_synod')).toBeNull();
    });
  });

  it('Issue token on a row opens the lifetime + label modal and sends both to issue-token', async () => {
    const calls = mockFetch((c) => {
      if (c.method === 'POST' && c.url === '/v1/operators/ci-bot/issue-token') {
        return { status: 200, body: { aid: 'ci-bot', jwt: 'eyJ.ci.tok', jwt_id: '01JC1B0T000000000000000000', expires_at: '2026-11-25T00:00:00Z' } };
      }
      return operatorsList(c);
    });
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('issue-token-ci-bot'));
    // A machine operator defaults to the longest preset.
    expect(screen.getByTestId('issue-jwt-preset-90d')).toBeChecked();
    expect(screen.queryByTestId('issued-jwt')).toBeNull();
    await user.click(screen.getByTestId('issue-jwt-preset-30d'));
    await user.type(screen.getByTestId('issue-jwt-label'), 'ci prod');
    await user.click(screen.getByTestId('issue-jwt-submit'));

    expect(await screen.findByTestId('issued-jwt')).toHaveTextContent('eyJ.ci.tok');
    const post = calls.find((c) => c.method === 'POST' && c.url === '/v1/operators/ci-bot/issue-token');
    expect(post?.body).toEqual({ label: 'ci prod', ttl: '30d' });
  });

  it('an Archon that is not a machine operator keeps the 30-day default', async () => {
    mockFetch(operatorsList);
    renderWithProviders(<ArchonsList />, '/archons');
    await userEvent.click(await screen.findByTestId('issue-token-alice'));
    expect(screen.getByTestId('issue-jwt-preset-30d')).toBeChecked();
  });

  it('a lifetime the Keeper refuses shows its 422 detail', async () => {
    const calls = mockFetch((c) => {
      if (c.method === 'POST' && c.url === '/v1/operators/ci-bot/issue-token') {
        return problem(422, 'validation-failed', 'ttl 200d is above auth.jwt.ttl_max (2160h)');
      }
      return operatorsList(c);
    });
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('issue-token-ci-bot'));
    await user.click(screen.getByTestId('issue-jwt-preset-custom'));
    await user.type(screen.getByTestId('issue-jwt-custom'), '200d');
    await user.click(screen.getByTestId('issue-jwt-submit'));
    expect(await screen.findByTestId('issue-jwt-error')).toHaveTextContent('ttl 200d is above auth.jwt.ttl_max (2160h)');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ ttl: '200d' });
  });

  it('Create with a Synod as the owner sends owner_synod', async () => {
    const calls = mockFetch((c) => {
      if (c.method === 'POST' && c.url === '/v1/operators') {
        return { status: 201, body: { aid: 'new-bot', display_name: 'New bot', created_at: '2026-10-26T00:00:00Z', jwt: 'eyJ.new.tok' } };
      }
      return operatorsList(c);
    });
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/alice@corp\.com/i), 'new-bot');
    await user.type(screen.getByPlaceholderText(/Alice Ops/i), 'New bot');
    await user.click(screen.getByTestId('archon-create-owner-kind-synod'));
    const select = screen.getByTestId('archon-create-owner-synod');
    await waitFor(() => expect(select).not.toBeDisabled());
    await user.selectOptions(select, 'dba');
    await user.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url === '/v1/operators');
      expect(post?.body).toEqual({ aid: 'new-bot', display_name: 'New bot', owner_synod: 'dba' });
    });
  });

  it('Create with a person as the owner offers only Archons that sign in themselves', async () => {
    const calls = mockFetch((c) => {
      if (c.method === 'POST' && c.url === '/v1/operators') {
        return { status: 201, body: { aid: 'new-bot', display_name: 'New bot', created_at: '2026-10-26T00:00:00Z', jwt: 'eyJ.new.tok' } };
      }
      return operatorsList(c);
    });
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/alice@corp\.com/i), 'new-bot');
    await user.type(screen.getByPlaceholderText(/Alice Ops/i), 'New bot');
    await user.click(screen.getByTestId('archon-create-owner-kind-archon'));
    // A chosen kind with no owner picked blocks Create.
    expect(screen.getByRole('button', { name: /Create/i })).toBeDisabled();
    await user.click(screen.getByTestId('archon-create-owner-archon-search'));
    await user.click(await screen.findByTestId('archon-create-owner-archon-option-alice'));
    expect(screen.queryByTestId('archon-create-owner-archon-option-ci-bot')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url === '/v1/operators');
      expect(post?.body).toEqual({ aid: 'new-bot', display_name: 'New bot', owner_aid: 'alice' });
    });
  });
});

function renderCard(aid: string) {
  return renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route path="/archons/:aid" element={<ArchonDetail />} />
      </Routes>
    </AuthProvider>,
    `/archons/${aid}`,
  );
}

describe('Archon card → owner', () => {
  beforeEach(() => {
    tokenStore.clear();
    tokenStore.set('a.eyJzdWIiOiJyb290In0.s');
  });

  it('Change sets a Synod as the owner: PUT /v1/operators/{aid}/owner', async () => {
    let current = op({ aid: 'ci-bot' });
    const calls = mockFetch((c) => {
      if (c.method === 'GET' && c.url === '/v1/operators/ci-bot') return { status: 200, body: current };
      if (c.method === 'PUT' && c.url === '/v1/operators/ci-bot/owner') {
        current = op({ aid: 'ci-bot', owner_synod: 'dba' });
        return { status: 204 };
      }
      return undefined;
    });
    renderCard('ci-bot');
    const user = userEvent.setup();
    expect(await screen.findByTestId('archon-owner')).toHaveTextContent('no owner');

    await user.click(screen.getByTestId('owner-change-btn'));
    const dialog = await screen.findByRole('dialog', { name: /Owner of ci-bot/ });
    await user.click(within(dialog).getByTestId('owner-set-kind-synod'));
    const select = within(dialog).getByTestId('owner-set-synod');
    await waitFor(() => expect(select).not.toBeDisabled());
    await user.selectOptions(select, 'dba');
    await user.click(within(dialog).getByTestId('owner-set-submit'));

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT' && c.url === '/v1/operators/ci-bot/owner')?.body).toEqual({ owner_synod: 'dba' }),
    );
    const owner = screen.getByTestId('archon-owner');
    await waitFor(() => expect(within(owner).getByRole('link', { name: 'dba' })).toHaveAttribute('href', '/synods/dba'));
    expect(screen.queryByRole('dialog', { name: /Owner of ci-bot/ })).toBeNull();
  });

  it('a refused owner keeps the modal open with the Keeper’s detail', async () => {
    mockFetch((c) => {
      if (c.method === 'GET' && c.url === '/v1/operators/ci-bot') return { status: 200, body: op({ aid: 'ci-bot' }) };
      if (c.method === 'PUT' && c.url === '/v1/operators/ci-bot/owner') {
        return problem(422, 'validation-failed', 'owner alice does not sign in itself');
      }
      return operatorsList(c);
    });
    renderCard('ci-bot');
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('owner-change-btn'));
    const dialog = await screen.findByRole('dialog', { name: /Owner of ci-bot/ });
    await user.click(within(dialog).getByTestId('owner-set-archon-search'));
    await user.click(await within(dialog).findByTestId('owner-set-archon-option-alice'));
    await user.click(within(dialog).getByTestId('owner-set-submit'));
    expect(await within(dialog).findByTestId('owner-set-error')).toHaveTextContent('owner alice does not sign in itself');
  });

  it('a revoked owner is flagged, and Clear removes it: DELETE /v1/operators/{aid}/owner', async () => {
    let current = op({ aid: 'sd-gateway', owner_aid: 'alice' });
    const calls = mockFetch((c) => {
      if (c.method === 'GET' && c.url === '/v1/operators/sd-gateway') return { status: 200, body: current };
      if (c.method === 'GET' && c.url === '/v1/operators/alice') {
        return { status: 200, body: op({ aid: 'alice', auth_method: 'ldap', created_via: 'ldap', revoked_at: '2026-10-20T00:00:00Z' }) };
      }
      if (c.method === 'DELETE' && c.url === '/v1/operators/sd-gateway/owner') {
        current = op({ aid: 'sd-gateway' });
        return { status: 204 };
      }
      return undefined;
    });
    renderCard('sd-gateway');
    const user = userEvent.setup();
    const owner = await screen.findByTestId('archon-owner');
    expect(within(owner).getByRole('link', { name: 'alice' })).toHaveAttribute('href', '/archons/alice');
    expect(await screen.findByTestId('archon-owner-revoked')).toHaveTextContent('revoked');

    await user.click(screen.getByTestId('owner-clear-btn'));
    await user.click(await screen.findByTestId('owner-clear-confirm'));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/v1/operators/sd-gateway/owner')).toBe(true));
    await waitFor(() => expect(screen.getByTestId('archon-owner')).toHaveTextContent('no owner'));
  });

  it('a revoked machine operator offers Clear but not Change, and Clear sends DELETE', async () => {
    let current = op({ aid: 'sd-dict', owner_synod: 'dba', revoked_at: '2026-10-25T00:00:00Z' });
    const calls = mockFetch((c) => {
      if (c.method === 'GET' && c.url === '/v1/operators/sd-dict') return { status: 200, body: current };
      if (c.method === 'DELETE' && c.url === '/v1/operators/sd-dict/owner') {
        current = op({ aid: 'sd-dict', revoked_at: '2026-10-25T00:00:00Z' });
        return { status: 204 };
      }
      return undefined;
    });
    renderCard('sd-dict');
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('owner-clear-btn'));
    expect(screen.queryByTestId('owner-change-btn')).toBeNull();
    expect(screen.getByText(/its owner can only be cleared/)).toBeInTheDocument();
    await user.click(await screen.findByTestId('owner-clear-confirm'));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/v1/operators/sd-dict/owner')).toBe(true));
  });

  it('Clear refused shows the server detail in the confirm', async () => {
    mockFetch((c) => {
      if (c.method === 'GET' && c.url === '/v1/operators/sd-dict') return { status: 200, body: op({ aid: 'sd-dict', owner_synod: 'dba' }) };
      if (c.method === 'DELETE' && c.url === '/v1/operators/sd-dict/owner') return problem(422, 'validation-failed', 'only an operator with auth_method jwt created through the Operator API has an owner');
      return undefined;
    });
    renderCard('sd-dict');
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('owner-clear-btn'));
    await user.click(await screen.findByTestId('owner-clear-confirm'));
    expect(await screen.findByTestId('owner-clear-error')).toHaveTextContent('only an operator with auth_method jwt');
  });

  it('the bootstrap Archon (jwt, created_via bootstrap) has no owner section', async () => {
    mockFetch((c) =>
      c.method === 'GET' && c.url === '/v1/operators/admin'
        ? { status: 200, body: op({ aid: 'admin', display_name: 'Admin', created_via: 'bootstrap', bootstrap_initial: true }) }
        : undefined,
    );
    renderCard('admin');
    await screen.findByRole('heading', { name: 'Admin' });
    expect(screen.queryByTestId('archon-owner')).toBeNull();
  });

  it('an Archon that cannot have an owner has no owner section', async () => {
    mockFetch((c) =>
      c.method === 'GET' && c.url === '/v1/operators/alice'
        ? { status: 200, body: op({ aid: 'alice', display_name: 'Alice', auth_method: 'ldap', created_via: 'ldap' }) }
        : undefined,
    );
    renderCard('alice');
    await screen.findByRole('heading', { name: 'Alice' });
    expect(screen.queryByTestId('archon-owner')).toBeNull();
  });

  it('Tokens → Issue token sends the lifetime to issue-token and refreshes the list', async () => {
    const calls = mockFetch((c) => {
      if (c.method === 'GET' && c.url === '/v1/operators/ci-bot') return { status: 200, body: op({ aid: 'ci-bot' }) };
      if (c.method === 'GET' && c.url.startsWith('/v1/operators/ci-bot/jwts')) return { status: 200, body: { items: [], offset: 0, limit: 50, total: 0 } };
      if (c.method === 'POST' && c.url === '/v1/operators/ci-bot/issue-token') {
        return { status: 200, body: { aid: 'ci-bot', jwt: 'eyJ.card.tok', jwt_id: '01JCARD0000000000000000000', expires_at: '2027-01-24T00:00:00Z' } };
      }
      return undefined;
    });
    renderCard('ci-bot');
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('archon-tab-tokens'));
    await screen.findByTestId('jwt-list-empty');
    const listsBefore = calls.filter((c) => c.url.startsWith('/v1/operators/ci-bot/jwts')).length;

    await user.click(screen.getByTestId('archon-issue-token-btn'));
    expect(screen.getByTestId('issue-jwt-preset-90d')).toBeChecked();
    await user.click(screen.getByTestId('issue-jwt-submit'));
    expect(await screen.findByTestId('issued-jwt')).toHaveTextContent('eyJ.card.tok');
    expect(calls.find((c) => c.method === 'POST' && c.url === '/v1/operators/ci-bot/issue-token')?.body).toEqual({ ttl: '90d' });
    await waitFor(() =>
      expect(calls.filter((c) => c.url.startsWith('/v1/operators/ci-bot/jwts')).length).toBeGreaterThan(listsBefore),
    );
  });

  it('without operator.issue-token and operator.set-owner the card offers neither', async () => {
    mockFetch((c) => {
      if (c.method === 'GET' && c.url === '/v1/operators/ci-bot') return { status: 200, body: op({ aid: 'ci-bot' }) };
      if (c.method === 'GET' && c.url.startsWith('/v1/operators/ci-bot/jwts')) return { status: 200, body: { items: [], offset: 0, limit: 50, total: 0 } };
      if (c.method === 'GET' && c.url.startsWith('/v1/me/permissions')) {
        return { status: 200, body: { permissions: [{ resource: 'operator', action: 'list' }] } };
      }
      return undefined;
    });
    renderCard('ci-bot');
    const user = userEvent.setup();
    await screen.findByTestId('archon-owner');
    await waitFor(() => expect(screen.queryByTestId('owner-change-btn')).toBeNull());
    await user.click(screen.getByTestId('archon-tab-tokens'));
    await screen.findByTestId('jwt-list-empty');
    expect(screen.queryByTestId('archon-issue-token-btn')).toBeNull();
  });
});
