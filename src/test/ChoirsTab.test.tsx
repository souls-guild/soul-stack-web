import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { IncarnationDetail } from '../pages/incarnations/IncarnationDetail';
import { ChoirsTab } from '../pages/incarnations/ChoirsTab';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

// Base incarnation fixture.
const INCARNATION = {
  id: 'redis-prod',
  service: 'redis',
  service_version: 'v2.0.0',
  state_schema_version: 3,
  covens: ['prod'],
  state: {},
  status: 'ready',
  created_by_aid: 'archon-alice',
  created_at: '2026-05-20T10:00:00Z',
  updated_at: '2026-05-25T12:00:00Z',
};

// The roster the Add-Voice picker offers: `incarnation_membership`, not a label.
const MEMBERS = {
  items: [
    { sid: 'host-a.local', status: 'connected', bound_at: '2026-05-27T00:00:00Z', bound_by_aid: 'archon-alice' },
    { sid: 'host-b.local', status: 'connected', bound_at: '2026-05-27T00:00:00Z', bound_by_aid: 'archon-alice' },
  ],
  offset: 0,
  limit: 200,
  total: 2,
};

// The souls registry answers the SAME hosts under no coven at all — belonging to
// redis-prod attaches no label (NIM-281). Kept deliberately disjoint from MEMBERS
// so a picker that went back to `GET /v1/souls?coven=redis-prod` finds nothing to
// offer and the selectOptions below fails, instead of passing on a coincidence.
const SOULS = {
  items: [
    { sid: 'stranger.local', transport: 'agent', status: 'connected', covens: ['redis-prod'], registered_at: '2026-05-27T00:00:00Z' },
  ],
  offset: 0,
  limit: 200,
  total: 1,
};

const MEMBERS_EMPTY = { items: [], offset: 0, limit: 200, total: 0 };

const CHOIRS_EMPTY = { items: [], offset: 0, limit: 100, total: 0 };

const CHOIRS_ONE = {
  items: [
    {
      incarnation_name: 'redis-prod',
      choir_name: 'primaries',
      description: 'Primary nodes',
      min_size: 1,
      max_size: 3,
      created_at: '2026-05-29T10:00:00Z',
      created_by_aid: 'archon-alice',
    },
  ],
  offset: 0,
  limit: 100,
  total: 1,
};

const VOICES_EMPTY = { items: [], offset: 0, limit: 100, total: 0 };

const VOICES_ONE = {
  items: [
    {
      incarnation_name: 'redis-prod',
      choir_name: 'primaries',
      sid: 'host-a.local',
      role: 'master',
      position: 0,
      added_at: '2026-05-29T11:00:00Z',
      added_by_aid: 'archon-alice',
    },
  ],
  offset: 0,
  limit: 100,
  total: 1,
};

describe('ChoirsTab', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  // --- rendering the tab via IncarnationDetail ---

  it('renders the Choirs tab, navigation opens the section', async () => {
    // More specific URLs go first (installFetchMock uses startsWith).
    installFetchMock([
      { method: 'GET', url: '/v1/incarnations/redis-prod/choirs', body: CHOIRS_EMPTY },
      { method: 'GET', url: '/v1/incarnations/redis-prod', body: INCARNATION },
    ]);

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/redis-prod',
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'redis-prod' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Choirs/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Choirs/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/No Choirs/i)).toBeInTheDocument();
  });

  // --- creating a Choir ---

  it('Create Choir — modal opens, POST is sent on submit', async () => {
    let postCount = 0;
    let lastBody: unknown = null;

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'POST' && url.includes('/choirs') && !url.includes('/voices')) {
        postCount += 1;
        lastBody = init?.body ? JSON.parse(init.body as string) : null;
        return new Response(
          JSON.stringify({
            incarnation_name: 'redis-prod',
            choir_name: 'primaries',
            description: null,
            min_size: null,
            max_size: null,
            created_at: '2026-05-29T10:00:00Z',
            created_by_aid: 'archon-alice',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/choirs')) {
        return new Response(JSON.stringify(CHOIRS_EMPTY), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(INCARNATION), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/redis-prod',
    );

    await waitFor(() => screen.getByRole('heading', { name: 'redis-prod' }));

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Choirs/i }));
    await waitFor(() => screen.getByRole('heading', { name: /Choirs/i }));

    // Open the create modal (aria-label - a button, not empty-hint).
    const createBtn = screen.getAllByRole('button').find((b) => /Create Choir/.test(b.textContent ?? ''))!;
    await user.click(createBtn);

    // Fill in the name.
    const nameInput = screen.getByTestId('choir-name-input');
    await user.type(nameInput, 'primaries');

    // Submit.
    await user.click(screen.getByTestId('create-choir-submit'));

    await waitFor(() => {
      expect(postCount).toBe(1);
    });
    expect(lastBody).toMatchObject({ choir_name: 'primaries' });
  });

  // --- choir name validation ---

  it('choir_name with invalid pattern → form error, POST is not sent', async () => {
    let postCount = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST') postCount += 1;
      if (url.includes('/choirs')) {
        return new Response(JSON.stringify(CHOIRS_EMPTY), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(INCARNATION), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/redis-prod',
    );

    await waitFor(() => screen.getByRole('heading', { name: 'redis-prod' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Choirs/i }));
    await waitFor(() => screen.getByRole('heading', { name: /Choirs/i }));

    const createBtn2 = screen.getAllByRole('button').find((b) => /Create Choir/.test(b.textContent ?? ''))!;
    await user.click(createBtn2);

    const nameInput = screen.getByTestId('choir-name-input');
    await user.type(nameInput, 'INVALID NAME!');
    await user.click(screen.getByTestId('create-choir-submit'));

    await waitFor(() => {
      expect(screen.getByText(/Name must match/)).toBeInTheDocument();
    });
    expect(postCount).toBe(0);
  });

  // --- deleting a Choir ---

  it('Delete Choir — confirm modal, DELETE is sent only after checkbox confirmation', async () => {
    let deleteCount = 0;

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'DELETE' && url.includes('/choirs/primaries')) {
        deleteCount += 1;
        return new Response('', { status: 204 });
      }
      if (url.includes('/choirs')) {
        return new Response(JSON.stringify(CHOIRS_ONE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(INCARNATION), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/redis-prod',
    );

    await waitFor(() => screen.getByRole('heading', { name: 'redis-prod' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Choirs/i }));

    await waitFor(() => {
      expect(screen.getByTestId('delete-choir-primaries')).toBeInTheDocument();
    });

    // Click delete.
    await user.click(screen.getByTestId('delete-choir-primaries'));

    // Modal opened. DELETE hasn't been sent yet.
    const confirmBtn = screen.getByTestId('delete-choir-confirm');
    expect(confirmBtn).toBeDisabled();
    expect(deleteCount).toBe(0);

    // Checkbox -> confirm.
    await user.click(screen.getByTestId('delete-choir-checkbox'));
    expect(confirmBtn).not.toBeDisabled();
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(deleteCount).toBe(1);
    });
  });

  // --- adding a Voice ---

  it('Add Voice → POST is sent with sid/role/position', async () => {
    let voicePostCount = 0;
    let lastVoiceBody: unknown = null;

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'POST' && url.includes('/voices')) {
        voicePostCount += 1;
        lastVoiceBody = init?.body ? JSON.parse(init.body as string) : null;
        return new Response(
          JSON.stringify({
            incarnation_name: 'redis-prod',
            choir_name: 'primaries',
            sid: 'host-a.local',
            role: 'master',
            position: 0,
            added_at: '2026-05-29T11:00:00Z',
            added_by_aid: 'archon-alice',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/voices')) {
        return new Response(JSON.stringify(VOICES_EMPTY), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/choirs')) {
        return new Response(JSON.stringify(CHOIRS_ONE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/members')) {
        return new Response(JSON.stringify(MEMBERS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/v1/souls')) {
        return new Response(JSON.stringify(SOULS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(INCARNATION), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/redis-prod',
    );

    await waitFor(() => screen.getByRole('heading', { name: 'redis-prod' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Choirs/i }));

    // Expand the choir.
    await waitFor(() => screen.getByTestId('choir-toggle-primaries'));
    await user.click(screen.getByTestId('choir-toggle-primaries'));

    // "Add Voice" button.
    await waitFor(() => screen.getByText(/Add Voice/i));
    await user.click(screen.getByText(/Add Voice/i));

    // Select SID.
    await waitFor(() => screen.getByTestId('voice-sid-select'));
    await user.selectOptions(screen.getByTestId('voice-sid-select'), 'host-a.local');

    // Role.
    await user.type(screen.getByTestId('voice-role-input'), 'master');

    // Position.
    await user.type(screen.getByTestId('voice-position-input'), '0');

    await user.click(screen.getByTestId('add-voice-submit'));

    await waitFor(() => {
      expect(voicePostCount).toBe(1);
    });
    expect(lastVoiceBody).toMatchObject({ sid: 'host-a.local', role: 'master', position: 0 });
  });

  // --- 422 ErrNotMembers ---

  it('422 ErrNotMembers on add voice → human-readable message', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'POST' && url.includes('/voices')) {
        return new Response(
          JSON.stringify({ title: 'Unprocessable', detail: 'not a member' }),
          { status: 422, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/voices')) {
        return new Response(JSON.stringify(VOICES_EMPTY), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/choirs')) {
        return new Response(JSON.stringify(CHOIRS_ONE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/members')) {
        return new Response(JSON.stringify(MEMBERS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/v1/souls')) {
        return new Response(JSON.stringify(SOULS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(INCARNATION), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/redis-prod',
    );

    await waitFor(() => screen.getByRole('heading', { name: 'redis-prod' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Choirs/i }));

    await waitFor(() => screen.getByTestId('choir-toggle-primaries'));
    await user.click(screen.getByTestId('choir-toggle-primaries'));

    await waitFor(() => screen.getByText(/Add Voice/i));
    await user.click(screen.getByText(/Add Voice/i));

    await waitFor(() => screen.getByTestId('voice-sid-select'));
    await user.selectOptions(screen.getByTestId('voice-sid-select'), 'host-a.local');
    await user.click(screen.getByTestId('add-voice-submit'));

    await waitFor(() => {
      // The message names the act that actually fixes it — binding on the Hosts
      // tab — and says outright that a Coven does not. It used to send the
      // operator to assign `coven=redis-prod` in the Souls registry, which under
      // NIM-281 attaches a label and no membership: they would come back, hit the
      // same 422, and have no reason to doubt the instruction.
      expect(screen.getByTestId('add-voice-error')).toHaveTextContent(/not a member of the incarnation/i);
      expect(screen.getByTestId('add-voice-error')).toHaveTextContent(/Hosts tab/i);
      expect(screen.queryByText(/coven=redis-prod/i)).not.toBeInTheDocument();
    });
  });

  // --- the picker has nothing to offer, for two different reasons ---

  it('empty roster → says to bind a host, not that everyone is already a Voice', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes('/voices')) {
        return new Response(JSON.stringify(VOICES_EMPTY), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/choirs')) {
        return new Response(JSON.stringify(CHOIRS_ONE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/members')) {
        return new Response(JSON.stringify(MEMBERS_EMPTY), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/v1/souls')) {
        return new Response(JSON.stringify(SOULS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(INCARNATION), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/redis-prod',
    );

    await waitFor(() => screen.getByRole('heading', { name: 'redis-prod' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Choirs/i }));

    await waitFor(() => screen.getByTestId('choir-toggle-primaries'));
    await user.click(screen.getByTestId('choir-toggle-primaries'));

    await waitFor(() => screen.getByText(/Add Voice/i));
    await user.click(screen.getByText(/Add Voice/i));

    // Nobody is bound yet, so there is nothing to pick and no Voice to have taken
    // it. "Every member is already a Voice" would send the operator looking for a
    // roster that does not exist; the fix is on the Hosts tab.
    await waitFor(() => expect(screen.getByText(/bind one on the Hosts tab/i)).toBeInTheDocument());
    expect(screen.queryByText(/already a Voice/i)).not.toBeInTheDocument();
  });

  it('forbidden roster → says the roster is unreadable, not that the incarnation is empty', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes('/voices')) {
        return new Response(JSON.stringify(VOICES_EMPTY), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/choirs')) {
        return new Response(JSON.stringify(CHOIRS_ONE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/members')) {
        // Reading the roster needs `incarnation.get` on THIS incarnation, which is a
        // narrower right than the one that opened this page. 403 here is an ordinary
        // answer for a legitimately scoped operator, not a broken backend.
        return new Response(JSON.stringify({ title: 'Forbidden', detail: 'out of scope' }), {
          status: 403,
          headers: { 'Content-Type': 'application/problem+json' },
        });
      }
      if (url.includes('/v1/souls')) {
        return new Response(JSON.stringify(SOULS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(INCARNATION), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/redis-prod',
    );

    await waitFor(() => screen.getByRole('heading', { name: 'redis-prod' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Choirs/i }));

    await waitFor(() => screen.getByTestId('choir-toggle-primaries'));
    await user.click(screen.getByTestId('choir-toggle-primaries'));

    await waitFor(() => screen.getByText(/Add Voice/i));
    await user.click(screen.getByText(/Add Voice/i));

    // An empty dropdown and no message is the same picture as "no host is bound" —
    // the very thing the test above proves this screen now states outright. Those
    // two must not collapse into one, or the honest message makes the silent case
    // read as a fact.
    const err = await screen.findByTestId('voice-roster-error');
    expect(err.textContent).toMatch(/may not read/i);
    expect(screen.queryByText(/bind one on the Hosts tab/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/already a Voice/i)).not.toBeInTheDocument();
  });

  // --- deleting a Voice ---

  it('Remove Voice — Trash2 button sends DELETE', async () => {
    let deleteVoiceCount = 0;

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'DELETE' && url.includes('/voices/host-a.local')) {
        deleteVoiceCount += 1;
        return new Response('', { status: 204 });
      }
      if (url.includes('/voices')) {
        return new Response(JSON.stringify(VOICES_ONE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/choirs')) {
        return new Response(JSON.stringify(CHOIRS_ONE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(INCARNATION), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/:name" element={<IncarnationDetail />} />
      </Routes>,
      '/incarnations/redis-prod',
    );

    await waitFor(() => screen.getByRole('heading', { name: 'redis-prod' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Choirs/i }));

    await waitFor(() => screen.getByTestId('choir-toggle-primaries'));
    await user.click(screen.getByTestId('choir-toggle-primaries'));

    // Wait for Voices to appear in the table.
    await waitFor(() => {
      expect(screen.getByText('host-a.local')).toBeInTheDocument();
    });

    // Click Trash2 to delete Voice.
    await user.click(screen.getByTestId('remove-voice-host-a.local'));

    await waitFor(() => {
      expect(deleteVoiceCount).toBe(1);
    });
  });

  // --- direct render of ChoirsTab (graceful empty-state) ---

  it('ChoirsTab — graceful empty-state without crash on empty data', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/incarnations/x/choirs', body: CHOIRS_EMPTY },
    ]);
    renderWithProviders(
      <ChoirsTab incarnationName="x" />,
    );
    await waitFor(() => {
      expect(screen.getByText(/No Choirs/i)).toBeInTheDocument();
    });
  });

  // --- Choir list with description and min/max ---

  it('Choir with description/min_size/max_size renders without crash', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/incarnations/redis-prod/choirs', body: CHOIRS_ONE },
    ]);
    renderWithProviders(<ChoirsTab incarnationName="redis-prod" />);

    await waitFor(() => {
      expect(screen.getByText('primaries')).toBeInTheDocument();
    });
    expect(screen.getByText('Primary nodes')).toBeInTheDocument();
    // min/max is displayed.
    expect(screen.getByText(/1…3/)).toBeInTheDocument();
  });

  // --- graceful-404: choir subsystem unavailable ---

  it('choirs.list 404 → graceful placeholder, not error-box', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url.includes('/choirs')) {
        return new Response(JSON.stringify({ title: 'Not Found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(INCARNATION), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(<ChoirsTab incarnationName="redis-prod" />);

    await waitFor(() => {
      expect(screen.getByTestId('choirs-degraded')).toBeInTheDocument();
    });
    // There should be no red error-box with choirsLoadFailed.
    expect(screen.queryByText(/Failed to load Choir/i)).not.toBeInTheDocument();
  });

  // --- DeleteChoir confirm modal ---

  it('DeleteChoirModal: Delete button disabled without checkbox confirmation', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/incarnations/redis-prod/choirs', body: CHOIRS_ONE },
    ]);
    renderWithProviders(<ChoirsTab incarnationName="redis-prod" />);

    await waitFor(() => screen.getByTestId('delete-choir-primaries'));
    const user = userEvent.setup();
    await user.click(screen.getByTestId('delete-choir-primaries'));

    const confirmBtn = screen.getByTestId('delete-choir-confirm');
    expect(confirmBtn).toBeDisabled();

    // After the checkbox - enabled.
    await user.click(screen.getByTestId('delete-choir-checkbox'));
    expect(confirmBtn).not.toBeDisabled();
  });
});
