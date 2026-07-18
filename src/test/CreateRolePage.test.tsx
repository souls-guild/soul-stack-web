import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { CreateRolePage } from '../pages/rbac/CreateRolePage';
import { tokenStore } from '../api/tokenStore';

const PERMISSIONS_SAMPLE = {
  items: [
    {
      resource: 'incarnation',
      actions: [
        { action: 'read', selector_keys: ['service'] },
        { action: 'run', selector_keys: ['service'] },
        { action: 'destroy', selector_keys: ['service'] },
      ],
    },
    {
      resource: 'soul',
      actions: [
        { action: 'list', selector_keys: ['coven', 'sid'] },
        { action: 'read', selector_keys: ['coven', 'sid'] },
      ],
    },
    {
      resource: 'audit',
      actions: [{ action: 'read', selector_keys: [] }],
    },
  ],
};

interface Call {
  url: string;
  method: string;
  body: string | null;
}

function recordingFetch(opts?: {
  conflict?: { path: RegExp; method: string; status: number; type?: string; detail?: string };
}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : null;
    calls.push({ url, method, body });

    if (opts?.conflict && opts.conflict.path.test(url) && method === opts.conflict.method) {
      return new Response(
        JSON.stringify({
          type: opts.conflict.type ?? 'about:blank',
          title: 'Conflict',
          status: opts.conflict.status,
          detail: opts.conflict.detail ?? 'conflict',
        }),
        { status: opts.conflict.status, headers: { 'Content-Type': 'application/problem+json' } },
      );
    }
    if (url.startsWith('/v1/permissions') && method === 'GET') {
      return new Response(JSON.stringify(PERMISSIONS_SAMPLE), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('/v1/incarnations') && method === 'GET') {
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 200, total: 0 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('/v1/services') && method === 'GET') {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('/v1/souls') && method === 'GET') {
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 500, total: 0 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === '/v1/roles' && method === 'POST') return new Response('', { status: 201 });
    return new Response('{}', { status: 599 });
  });
  return calls;
}

// Routing: page at /rbac/roles/new, marker at /rbac to verify navigation.
function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/rbac" element={<div>RBAC-LANDING</div>} />
      <Route path="/rbac/roles/new" element={<CreateRolePage />} />
    </Routes>,
    '/rbac/roles/new',
  );
}

describe('CreateRolePage (NIM-80)', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('renders the form and the permission catalog (master-detail)', async () => {
    recordingFetch();
    renderPage();
    const user = userEvent.setup();
    expect(screen.getByRole('heading', { name: /Create role/i })).toBeInTheDocument();
    // audit sorts first → its action shows by default in the right panel.
    expect(await screen.findByRole('checkbox', { name: 'audit.read' })).toBeInTheDocument();
    // Selecting a resource in the left rail reveals its action-wildcard.
    await user.click(screen.getByRole('button', { name: 'resource incarnation' }));
    expect(screen.getByRole('checkbox', { name: /incarnation\.\*/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'resource soul' }));
    expect(screen.getByRole('checkbox', { name: /soul\.\*/ })).toBeInTheDocument();
  });

  it('name + wildcard incarnation.* → POST with ["incarnation.*"] and navigation to /rbac', async () => {
    const calls = recordingFetch();
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('soul-operator'), 'inc-admin');
    await user.click(await screen.findByRole('button', { name: 'resource incarnation' }));
    const wildcard = screen.getByRole('checkbox', { name: /incarnation\.\*/ });
    await user.click(wildcard);
    await user.click(screen.getByRole('button', { name: /^Create$/ }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/roles' && c.method === 'POST');
      expect(post).toBeDefined();
      expect(post!.body).toContain('"name":"inc-admin"');
      expect(post!.body).toContain('"incarnation.*"');
      // Not an enumeration of actions.
      expect(post!.body).not.toContain('incarnation.read');
    });
    // Success → navigation to /rbac.
    await waitFor(() => expect(screen.getByText('RBAC-LANDING')).toBeInTheDocument());
  });

  it('scope on the page: soul.list + coven=ops → POST "soul.list on coven=ops"', async () => {
    const calls = recordingFetch();
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('soul-operator'), 'soul-ops');
    await user.click(await screen.findByRole('button', { name: 'resource soul' }));
    const cb = screen.getByRole('checkbox', { name: 'soul.list' });
    await user.click(cb);
    const keySelect = await screen.findByRole('combobox', { name: /^scope selector key$/i });
    await user.selectOptions(keySelect, 'coven');
    const valueInput = await screen.findByRole('textbox', { name: /value for coven$/i });
    await user.type(valueInput, 'ops');
    await user.click(screen.getByRole('button', { name: /^Create$/ }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/roles' && c.method === 'POST');
      expect(post).toBeDefined();
      expect(post!.body).toContain('soul.list on coven=ops');
    });
  });

  it('409 already-exists → error visible, page is not left', async () => {
    recordingFetch({
      conflict: {
        path: /^\/v1\/roles$/,
        method: 'POST',
        status: 409,
        type: 'https://soul-stack.io/errors/role-already-exists',
        detail: 'role log-reader already exists',
      },
    });
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('soul-operator'), 'log-reader');
    await user.click(screen.getByRole('button', { name: /^Create$/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/already exists/i);
    // Stay on the page (the /rbac marker did not appear).
    expect(screen.queryByText('RBAC-LANDING')).not.toBeInTheDocument();
  });

  it('invalid name (not kebab-case) → client validation, POST is not sent', async () => {
    const calls = recordingFetch();
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('soul-operator'), 'Bad Name');
    await user.click(screen.getByRole('button', { name: /^Create$/ }));

    // Zod validation blocks submit — POST must not be sent.
    await waitFor(() => {
      expect(screen.getByText(/kebab-case/i)).toBeInTheDocument();
    });
    expect(calls.find((c) => c.url === '/v1/roles' && c.method === 'POST')).toBeUndefined();
  });

  it('#3: invalid scope (space in value) → permission error visible, POST is not sent', async () => {
    const calls = recordingFetch();
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('soul-operator'), 'scoped-role');
    await user.click(await screen.findByRole('button', { name: 'resource soul' }));
    const cb = screen.getByRole('checkbox', { name: 'soul.list' });
    await user.click(cb);
    const keySelect = await screen.findByRole('combobox', { name: /^scope selector key$/i });
    await user.selectOptions(keySelect, 'coven');
    const valueInput = await screen.findByRole('textbox', { name: /value for coven$/i });
    await user.type(valueInput, 'ops team'); // space → 'soul.list on coven=ops team' fails the regex
    await user.click(screen.getByRole('button', { name: /^Create$/ }));

    // Client validation catches the broken permission string — alert visible, POST not sent.
    expect(await screen.findByText(/invalid/i)).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/v1/roles' && c.method === 'POST')).toBeUndefined();
  });

  it('Cancel → back to /rbac without POST', async () => {
    const calls = recordingFetch();
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Cancel/i }));
    await waitFor(() => expect(screen.getByText('RBAC-LANDING')).toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST')).toBeUndefined();
  });
});
