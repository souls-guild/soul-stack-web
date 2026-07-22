/**
 * Tests for task A (ADR-042): event-types fetch in TidingModal.
 *
 * Verifies:
 *   1. GET /v1/event-types is fetched when TidingModal opens.
 *   2. Chips render from the backend response (areas + point_events).
 *   3. incarnation.run_completed (from point_events) is present in the chips.
 *   4. Fallback on fetch error: the form shows without a crash, no chips.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { NotificationsPage } from '../pages/notifications/NotificationsPage';
import { tokenStore } from '../api/tokenStore';

const EVENT_TYPES_CATALOG = {
  areas: [
    { name: 'scenario_run.*' },
    { name: 'command_run.*' },
    { name: 'voyage.*' },
    { name: 'cadence.*' },
  ],
  point_events: [
    { name: 'incarnation.drift_checked' },
    { name: 'incarnation.run_completed' },
  ],
};

const HERALDS_REPLY = {
  items: [{ name: 'ops-webhook', type: 'webhook', config: { url: 'https://example.com' }, secret_ref: null, enabled: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by_aid: 'archon-alice' }],
  offset: 0, limit: 200, total: 1,
};

const TIDINGS_REPLY = { items: [], offset: 0, limit: 200, total: 0 };

function setupMock(opts: { eventTypesFail?: boolean } = {}) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(`${method} ${url}`);

    if (url.startsWith('/v1/me/permissions')) {
      return new Response(JSON.stringify({ permissions: [{ wildcard: true }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/v1/event-types')) {
      if (opts.eventTypesFail) {
        return new Response(JSON.stringify({ type: 'about:blank', title: 'Error', status: 500, detail: 'internal' }), { status: 500, headers: { 'Content-Type': 'application/problem+json' } });
      }
      return new Response(JSON.stringify(EVENT_TYPES_CATALOG), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/v1/heralds')) {
      return new Response(JSON.stringify(HERALDS_REPLY), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/v1/tidings')) {
      return new Response(JSON.stringify(TIDINGS_REPLY), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 599 });
  });
  return calls;
}

function renderNotif(path = '/notifications') {
  return renderWithProviders(
    <Routes>
      <Route path="/notifications" element={<NotificationsPage />} />
    </Routes>,
    path,
  );
}

beforeEach(() => {
  tokenStore.clear();
});

describe('EventTypeCatalog — fetch from backend (ADR-042)', () => {
  it('GET /v1/event-types is called when TidingModal opens', async () => {
    const calls = setupMock();
    renderNotif('/notifications?tab=tidings');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByTestId('tiding-create-btn')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-create-btn'));
    await screen.findByRole('dialog', { name: /Create Tiding/i });

    await waitFor(() => {
      expect(calls.some((c) => c.includes('/v1/event-types'))).toBe(true);
    });
  });

  it('chips render from areas (backend response)', async () => {
    setupMock();
    renderNotif('/notifications?tab=tidings');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByTestId('tiding-create-btn')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-create-btn'));
    await screen.findByRole('dialog', { name: /Create Tiding/i });

    await waitFor(() => {
      expect(screen.getByTestId('event-type-chip-scenario_run.*')).toBeInTheDocument();
      expect(screen.getByTestId('event-type-chip-voyage.*')).toBeInTheDocument();
      expect(screen.getByTestId('event-type-chip-cadence.*')).toBeInTheDocument();
    });
  });

  it('incarnation.run_completed chip is present (from point_events)', async () => {
    setupMock();
    renderNotif('/notifications?tab=tidings');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByTestId('tiding-create-btn')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-create-btn'));
    await screen.findByRole('dialog', { name: /Create Tiding/i });

    await waitFor(() => {
      expect(screen.getByTestId('event-type-chip-incarnation.run_completed')).toBeInTheDocument();
    });
  });

  it('fallback on fetch error: form without crash, custom input available', async () => {
    setupMock({ eventTypesFail: true });
    renderNotif('/notifications?tab=tidings');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByTestId('tiding-create-btn')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-create-btn'));
    const dialog = await screen.findByRole('dialog', { name: /Create Tiding/i });

    // Form opened - no crash
    expect(dialog).toBeInTheDocument();

    // Custom input is available
    expect(within(dialog).getByTestId('tiding-custom-event-type-input')).toBeInTheDocument();
  });

  it('area chip has glob form scenario_run.* and the submit body contains exactly it (regression guard)', async () => {
    const calls = setupMock();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : null;
      const json = (obj: unknown, status = 200) =>
        new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

      if (url.startsWith('/v1/me/permissions')) return json({ permissions: [{ wildcard: true }] });
      if (url.startsWith('/v1/event-types')) return json(EVENT_TYPES_CATALOG);
      if (url.startsWith('/v1/heralds')) return json(HERALDS_REPLY);
      if (url.startsWith('/v1/tidings') && method === 'GET') return json(TIDINGS_REPLY);
      if (url === '/v1/tidings' && method === 'POST') {
        calls.push(`${method} ${url} BODY:${JSON.stringify(body)}`);
        return json({ name: 'area-t', herald: 'ops-webhook', event_types: ['scenario_run.*'], only_failures: false, only_changes: false, enabled: true, ephemeral: false, voyage_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, 201);
      }
      return new Response('{}', { status: 599 });
    });

    renderNotif('/notifications?tab=tidings');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByTestId('tiding-create-btn')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-create-btn'));
    const dialog = await screen.findByRole('dialog', { name: /Create Tiding/i });

    // The chip must be labeled exactly "scenario_run.*", not "scenario_run"
    await waitFor(() => {
      const chip = within(dialog).getByTestId('event-type-chip-scenario_run.*');
      expect(chip).toBeInTheDocument();
      expect(chip.textContent).toBe('scenario_run.*');
    });

    await user.type(within(dialog).getByTestId('tiding-name-input'), 'area-t');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'ops-webhook' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('tiding-herald-select'), 'ops-webhook');
    await user.click(within(dialog).getByTestId('event-type-chip-scenario_run.*'));
    await user.click(within(dialog).getByRole('button', { name: /Create/i }));

    await waitFor(() => {
      const postCall = calls.find((c) => c.includes('/v1/tidings') && c.includes('BODY:'));
      expect(postCall).toBeDefined();
      const bodyStr = postCall!.replace(/.*BODY:/, '');
      const parsed = JSON.parse(bodyStr) as { event_types: string[] };
      // Should be "scenario_run.*", not "scenario_run"
      expect(parsed.event_types).toContain('scenario_run.*');
      expect(parsed.event_types).not.toContain('scenario_run');
    });
  });

  it('a type from the backend is selected by click and lands in the body', async () => {
    const calls = setupMock();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : null;
      const json = (obj: unknown, status = 200) =>
        new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

      if (url.startsWith('/v1/me/permissions')) return json({ permissions: [{ wildcard: true }] });
      if (url.startsWith('/v1/event-types')) return json(EVENT_TYPES_CATALOG);
      if (url.startsWith('/v1/heralds')) return json(HERALDS_REPLY);
      if (url.startsWith('/v1/tidings') && method === 'GET') return json(TIDINGS_REPLY);
      if (url === '/v1/tidings' && method === 'POST') {
        calls.push(`${method} ${url} BODY:${JSON.stringify(body)}`);
        return json({ name: 'new-t', herald: 'ops-webhook', event_types: ['voyage.*'], only_failures: false, only_changes: false, enabled: true, ephemeral: false, voyage_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, 201);
      }
      return new Response('{}', { status: 599 });
    });

    renderNotif('/notifications?tab=tidings');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByTestId('tiding-create-btn')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-create-btn'));
    const dialog = await screen.findByRole('dialog', { name: /Create Tiding/i });

    await user.type(within(dialog).getByTestId('tiding-name-input'), 'my-t');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'ops-webhook' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('tiding-herald-select'), 'ops-webhook');

    // Wait for chips from the backend
    await waitFor(() => expect(within(dialog).getByTestId('event-type-chip-voyage.*')).toBeInTheDocument());
    await user.click(within(dialog).getByTestId('event-type-chip-voyage.*'));

    await user.click(within(dialog).getByRole('button', { name: /Create/i }));

    await waitFor(() => {
      const postCall = calls.find((c) => c.includes('/v1/tidings') && c.includes('BODY:'));
      expect(postCall).toBeDefined();
      const bodyStr = postCall!.replace(/.*BODY:/, '');
      const parsed = JSON.parse(bodyStr) as { event_types: string[] };
      expect(parsed.event_types).toContain('voyage.*');
    });
  });
});
