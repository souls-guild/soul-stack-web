import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { CreateSoulModal } from '../pages/souls/CreateSoulModal';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

describe('CreateSoulModal', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  it('renders the form with SID / transport / covens fields', async () => {
    installFetchMock([]);
    renderWithProviders(<CreateSoulModal open onClose={() => {}} />);

    expect(screen.getByLabelText('new host SID')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument(); // transport select
    expect(screen.getByLabelText('coven labels')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Register/i })).toBeInTheDocument();
  });

  it('Register button is disabled when SID is empty', async () => {
    installFetchMock([]);
    renderWithProviders(<CreateSoulModal open onClose={() => {}} />);

    const btn = screen.getByRole('button', { name: /Register/i });
    expect(btn).toBeDisabled();
  });

  it('invalid SID shows an error and disables the button', async () => {
    installFetchMock([]);
    const user = userEvent.setup();
    renderWithProviders(<CreateSoulModal open onClose={() => {}} />);

    const sidInput = screen.getByLabelText('new host SID');
    await user.type(sidInput, 'INVALID_SID!');

    await waitFor(() => {
      expect(screen.getByText(/Invalid SID/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Register/i })).toBeDisabled();
  });

  it('transport=agent — submit → POST /v1/souls → success with bootstrap_token', async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/souls',
        body: { items: [], offset: 0, limit: 200, total: 0 },
      },
      {
        method: 'POST',
        url: '/v1/souls',
        status: 201,
        body: {
          sid: 'host01.example.com',
          transport: 'agent',
          status: 'pending',
          registered_at: '2026-05-29T10:00:00Z',
          created_by_aid: 'archon-bootstrap',
          bootstrap_token: 'btoken-super-secret-abc123',
          expires_at: '2026-05-30T10:00:00Z',
        },
      },
    ]);

    // Intercept fetch to check the body
    const baseFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (init?.body) {
        try { calls.push({ method, url, body: JSON.parse(init.body as string) }); } catch { /* empty */ }
      }
      return baseFetch(input, init);
    });

    const user = userEvent.setup();
    renderWithProviders(<CreateSoulModal open onClose={() => {}} />);

    const sidInput = screen.getByLabelText('new host SID');
    await user.type(sidInput, 'host01.example.com');

    const registerBtn = screen.getByRole('button', { name: /Register/i });
    await waitFor(() => expect(registerBtn).not.toBeDisabled());
    await user.click(registerBtn);

    // success-state shows the token and warning
    await waitFor(() => {
      expect(screen.getByText('btoken-super-secret-abc123')).toBeInTheDocument();
    });
    expect(screen.getByText(/shown ONCE/i)).toBeInTheDocument();
  });

  it('transport=ssh — success without bootstrap_token, shows SSH message', async () => {
    installFetchMock([
      {
        method: 'POST',
        url: '/v1/souls',
        status: 201,
        body: {
          sid: 'host02.example.com',
          transport: 'ssh',
          status: 'pending',
          registered_at: '2026-05-29T10:00:00Z',
          created_by_aid: 'archon-bootstrap',
        },
      },
    ]);

    const user = userEvent.setup();
    renderWithProviders(<CreateSoulModal open onClose={() => {}} />);

    const sidInput = screen.getByLabelText('new host SID');
    await user.type(sidInput, 'host02.example.com');

    // switch transport to ssh
    const transportSelect = screen.getByRole('combobox');
    await user.selectOptions(transportSelect, 'ssh');

    const registerBtn = screen.getByRole('button', { name: /Register/i });
    await waitFor(() => expect(registerBtn).not.toBeDisabled());
    await user.click(registerBtn);

    await waitFor(() => {
      expect(screen.getByText(/SSH Soul registered/i)).toBeInTheDocument();
    });
    // token is not shown
    expect(screen.queryByText(/shown ONCE/i)).not.toBeInTheDocument();
  });

  it('entering two covens via chips → submit body contains covens: ["prod","blue"]', async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    installFetchMock([
      {
        method: 'POST',
        url: '/v1/souls',
        status: 201,
        body: {
          sid: 'host-chips.example.com',
          transport: 'agent',
          status: 'pending',
          registered_at: '2026-05-29T10:00:00Z',
          created_by_aid: 'archon-bootstrap',
          bootstrap_token: 'tok-abc',
          expires_at: '2026-05-30T10:00:00Z',
        },
      },
    ]);

    const baseFetch2 = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (init?.body) {
        try { calls.push({ method, url, body: JSON.parse(init.body as string) }); } catch { /* empty */ }
      }
      return baseFetch2(input, init);
    });

    const user = userEvent.setup();
    renderWithProviders(<CreateSoulModal open onClose={() => {}} />);

    const sidInput = screen.getByLabelText('new host SID');
    await user.type(sidInput, 'host-chips.example.com');

    // Enter the first coven chip: "prod" + Enter
    const chipsBox = screen.getByLabelText('coven labels');
    const chipsInput = chipsBox.querySelector('input') as HTMLInputElement;
    await user.click(chipsInput);
    await user.type(chipsInput, 'prod');
    await user.keyboard('{Enter}');

    // Enter the second coven chip: "blue" + Enter
    await user.type(chipsInput, 'blue');
    await user.keyboard('{Enter}');

    // Both chips are displayed
    expect(screen.getByText('prod')).toBeInTheDocument();
    expect(screen.getByText('blue')).toBeInTheDocument();

    const registerBtn = screen.getByRole('button', { name: /Register/i });
    await waitFor(() => expect(registerBtn).not.toBeDisabled());
    await user.click(registerBtn);

    await waitFor(() => {
      expect(calls.some((c) => {
        const b = c.body as { covens?: string[] };
        return c.method === 'POST' && Array.isArray(b?.covens) && b.covens.includes('prod') && b.covens.includes('blue');
      })).toBe(true);
    });
  });

  it('409 conflict → human-readable error', async () => {
    installFetchMock([
      {
        method: 'POST',
        url: '/v1/souls',
        status: 409,
        body: { type: 'about:blank', title: 'Conflict', detail: 'SID already exists' },
      },
    ]);

    const user = userEvent.setup();
    renderWithProviders(<CreateSoulModal open onClose={() => {}} />);

    const sidInput = screen.getByLabelText('new host SID');
    await user.type(sidInput, 'existing-host.example.com');

    const registerBtn = screen.getByRole('button', { name: /Register/i });
    await waitFor(() => expect(registerBtn).not.toBeDisabled());
    await user.click(registerBtn);

    await waitFor(() => {
      expect(screen.getByText(/A Soul with this SID already exists/i)).toBeInTheDocument();
    });
  });
});
