import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { installFetchMock, type FetchRoute } from './fetchMock';
import { MaintenanceTab } from '../pages/incarnations/MaintenanceTab';

// Every instant on the tab is rendered in the browser's zone. Pinned so the
// assertions read the user's own example and do not depend on the runner's TZ.
vi.mock('../pages/incarnations/maintenance', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../pages/incarnations/maintenance')>();
  return { ...mod, browserTimeZone: () => 'Europe/Moscow' };
});

const BASE = '/v1/incarnations/df-prod';

function permissions(perms: Array<{ resource: string; action: string }>) {
  return { permissions: perms.map((p) => ({ ...p, wildcard: false })) };
}
const READER = permissions([{ resource: 'incarnation', action: 'get' }]);
const WRITER = permissions([
  { resource: 'incarnation', action: 'get' },
  { resource: 'incarnation', action: 'maintenance-set' },
]);

const NIGHT = {
  id: 'w-night',
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  start_time: '02:00',
  duration_minutes: 180,
  timezone: 'Europe/Moscow',
  comment: 'night works',
  created_at: '2026-10-27T10:00:00Z',
  updated_at: '2026-10-27T10:00:00Z',
};
const SUNDAY = {
  id: 'w-sun',
  days: ['sun'],
  start_time: '10:00',
  duration_minutes: 240,
  timezone: 'Europe/Moscow',
  comment: 'planned maintenance',
  created_at: '2026-10-27T10:00:00Z',
  updated_at: '2026-10-27T10:00:00Z',
};
const SALE = {
  id: 'f-sale',
  starts_at: '2099-11-19T21:00:00Z',
  ends_at: '2099-12-02T21:00:00Z',
  comment: 'Sale',
  created_at: '2026-10-27T10:00:00Z',
  updated_at: '2026-10-27T10:00:00Z',
};

const CLOSED = { open_now: false, next_start: '2026-12-09T23:00:00Z' };

function routes(over: { perms?: unknown; windows?: unknown; freezes?: unknown; extra?: FetchRoute[] } = {}): FetchRoute[] {
  return [
    ...(over.extra ?? []),
    { method: 'GET', url: '/v1/me/permissions', body: over.perms ?? WRITER },
    { method: 'GET', url: `${BASE}/maintenance-windows`, body: over.windows ?? { items: [NIGHT, SUNDAY], status: CLOSED } },
    { method: 'GET', url: `${BASE}/freezes`, body: over.freezes ?? { items: [SALE] } },
  ];
}

function sent(method: string, urlPrefix: string): Array<{ url: string; body: unknown }> {
  const calls = (fetch as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls;
  return calls
    .filter(([u, init]) => (init?.method ?? 'GET') === method && u.startsWith(urlPrefix))
    .map(([u, init]) => ({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined }));
}

describe('MaintenanceTab', () => {
  // The status line drops the year inside the current one; a fixed "now" keeps the
  // expectations from expiring on 1 January. Only Date is faked — timers stay real.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-27T12:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists windows and freezes the way the user drew them, with the server status line', async () => {
    installFetchMock(routes());
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

    const night = await screen.findByTestId('mw-row-w-night');
    expect(night.textContent).toContain('Mon–Fri');
    expect(night.textContent).toContain('02:00–05:00');
    expect(night.textContent).toContain('Europe/Moscow');
    expect(night.textContent).toContain('“night works”');
    expect(screen.getByTestId('mw-row-w-sun').textContent).toContain('10:00–14:00');

    expect(screen.getByTestId('mw-status').textContent).toBe('Now: closed · next: Thu 10.12 02:00');

    const sale = await screen.findByTestId('freeze-row-f-sale');
    expect(sale.textContent).toContain('20.11.2099 – 02.12.2099');
    expect(sale.textContent).toContain('“Sale”');
    expect(sale.textContent).toContain('upcoming');
  });

  it('no windows: the line says a run may start any time', async () => {
    installFetchMock(routes({ windows: { items: [], status: { open_now: true, next_start: '2026-10-27T10:00:00Z' } }, freezes: { items: [] } }));
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

    expect(await screen.findByTestId('mw-empty')).toBeInTheDocument();
    expect(screen.getByTestId('mw-status').textContent).toBe('Now: open · no windows, a run may start at any time');
  });

  it('an active freeze is named on the status line with its end', async () => {
    const active = { ...SALE, starts_at: '2026-01-01T00:00:00Z' };
    installFetchMock(
      routes({
        windows: {
          items: [NIGHT],
          status: { open_now: false, next_start: '2099-12-02T23:00:00Z', active_freeze: active },
        },
        freezes: { items: [active] },
      }),
    );
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

    const line = await screen.findByTestId('mw-status');
    expect(line.textContent).toContain('Now: freeze “Sale” until');
    expect(line.textContent).toContain('03.12.2099 00:00');
    expect(line.textContent).toContain('next: Thu 03.12.2099 02:00');
    expect(within(screen.getByTestId('freeze-row-f-sale')).getByText('in force')).toBeInTheDocument();
  });

  it('without incarnation.maintenance-set every write control is hidden', async () => {
    installFetchMock(routes({ perms: READER }));
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);

    await screen.findByTestId('mw-row-w-night');
    await waitFor(() => expect(screen.queryByTestId('mw-add')).not.toBeInTheDocument());
    expect(screen.queryByTestId('mw-copy-open')).not.toBeInTheDocument();
    expect(screen.queryByTestId('freeze-add')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mw-edit-w-night')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mw-delete-w-night')).not.toBeInTheDocument();
    expect(screen.queryByTestId('freeze-edit-f-sale')).not.toBeInTheDocument();
    expect(screen.queryByTestId('freeze-delete-f-sale')).not.toBeInTheDocument();
  });

  it('adds a window: the end time becomes a duration on the wire', async () => {
    installFetchMock(routes({ extra: [{ method: 'POST', url: `${BASE}/maintenance-windows`, status: 201, body: NIGHT }] }));
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('mw-add'));
    for (const d of ['mon', 'tue', 'wed', 'thu', 'fri']) await user.click(screen.getByTestId(`mw-day-${d}`));
    const start = screen.getByTestId('mw-start');
    await user.clear(start);
    await user.type(start, '22:00');
    const end = screen.getByTestId('mw-end');
    await user.clear(end);
    await user.type(end, '02:30');
    const tz = screen.getByTestId('mw-timezone');
    await user.clear(tz);
    await user.type(tz, 'Europe/Moscow');
    await user.type(screen.getByTestId('mw-comment'), 'night works');
    expect(screen.getByTestId('mw-duration-hint').textContent).toContain('Crosses midnight');
    await user.click(screen.getByTestId('mw-submit'));

    await waitFor(() => expect(sent('POST', `${BASE}/maintenance-windows`)).toHaveLength(1));
    expect(sent('POST', `${BASE}/maintenance-windows`)[0].body).toEqual({
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      start_time: '22:00',
      duration_minutes: 270,
      timezone: 'Europe/Moscow',
      comment: 'night works',
    });
  });

  it('refuses a window with no day and an unknown zone before asking the server', async () => {
    installFetchMock(routes());
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('mw-add'));
    const tz = screen.getByTestId('mw-timezone');
    await user.clear(tz);
    await user.type(tz, 'Mars/Olympus');
    await user.click(screen.getByTestId('mw-submit'));

    expect(await screen.findByText('Pick at least one day.')).toBeInTheDocument();
    expect(screen.getByText(/Unknown time zone/)).toBeInTheDocument();
    expect(sent('POST', `${BASE}/maintenance-windows`)).toHaveLength(0);
  });

  it('edits a window with PUT and the row\'s own values as the start', async () => {
    installFetchMock(routes({ extra: [{ method: 'PUT', url: `${BASE}/maintenance-windows/w-sun`, body: SUNDAY }] }));
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('mw-edit-w-sun'));
    expect((screen.getByTestId('mw-end') as HTMLInputElement).value).toBe('14:00');
    await user.click(screen.getByTestId('mw-day-sat'));
    await user.click(screen.getByTestId('mw-submit'));

    await waitFor(() => expect(sent('PUT', `${BASE}/maintenance-windows/w-sun`)).toHaveLength(1));
    expect(sent('PUT', `${BASE}/maintenance-windows/w-sun`)[0].body).toMatchObject({
      days: ['sat', 'sun'],
      start_time: '10:00',
      duration_minutes: 240,
    });
  });

  it('deletes a window after confirmation, and the dialog closes', async () => {
    installFetchMock(routes({ extra: [{ method: 'DELETE', url: `${BASE}/maintenance-windows/w-night`, status: 204 }] }));
    // The answer arrives after the pending render, as it does over a network: a
    // success callback that closes only when nothing is pending then sees "pending".
    const answer = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'DELETE') await new Promise((r) => setTimeout(r, 30));
        return answer(input, init);
      }),
    );
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('mw-delete-w-night'));
    expect(sent('DELETE', BASE)).toHaveLength(0);
    await user.click(screen.getByTestId('maintenance-delete-confirm'));
    await waitFor(() => expect(sent('DELETE', `${BASE}/maintenance-windows/w-night`)).toHaveLength(1));
    // The modal closes only on success; a 204 the client choked on would leave it open.
    await waitFor(() => expect(screen.queryByTestId('maintenance-delete-confirm')).not.toBeInTheDocument());
  });

  it('adds a whole-day freeze: the last day is inclusive, the wire end exclusive', async () => {
    installFetchMock(routes({ extra: [{ method: 'POST', url: `${BASE}/freezes`, status: 201, body: SALE }] }));
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('freeze-add'));
    const s = screen.getByTestId('freeze-start-date');
    await user.clear(s);
    await user.type(s, '2026-11-20');
    const e = screen.getByTestId('freeze-end-date');
    await user.clear(e);
    await user.type(e, '2026-12-02');
    await user.type(screen.getByTestId('freeze-comment'), 'Sale');
    await user.click(screen.getByTestId('freeze-submit'));

    await waitFor(() => expect(sent('POST', `${BASE}/freezes`)).toHaveLength(1));
    // Midnight in the browser zone (pinned to Moscow), not in the runner's.
    expect(sent('POST', `${BASE}/freezes`)[0].body).toEqual({
      starts_at: '2026-11-19T21:00:00.000Z',
      ends_at: '2026-12-02T21:00:00.000Z',
      comment: 'Sale',
    });
  });

  it('unticking «Whole days» on an edited freeze keeps its end, it does not lose a day', async () => {
    installFetchMock(routes({ extra: [{ method: 'PUT', url: `${BASE}/freezes/f-sale`, body: SALE }] }));
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('freeze-edit-f-sale'));
    expect((screen.getByTestId('freeze-end-date') as HTMLInputElement).value).toBe('2099-12-02');
    await user.click(screen.getByTestId('freeze-whole-days'));
    expect((screen.getByTestId('freeze-end-date') as HTMLInputElement).value).toBe('2099-12-03');
    expect((screen.getByTestId('freeze-end-time') as HTMLInputElement).value).toBe('00:00');
    await user.click(screen.getByTestId('freeze-submit'));

    await waitFor(() => expect(sent('PUT', `${BASE}/freezes/f-sale`)).toHaveLength(1));
    expect(sent('PUT', `${BASE}/freezes/f-sale`)[0].body).toMatchObject({
      starts_at: '2099-11-19T21:00:00.000Z',
      ends_at: '2099-12-02T21:00:00.000Z',
    });
  });

  it('refuses a freeze that ends before it starts', async () => {
    installFetchMock(routes());
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('freeze-add'));
    await user.click(screen.getByTestId('freeze-whole-days'));
    const s = screen.getByTestId('freeze-start-date');
    await user.clear(s);
    await user.type(s, '2026-11-20');
    const e = screen.getByTestId('freeze-end-date');
    await user.clear(e);
    await user.type(e, '2026-11-20');
    const st = screen.getByTestId('freeze-start-time');
    await user.clear(st);
    await user.type(st, '18:00');
    const et = screen.getByTestId('freeze-end-time');
    await user.clear(et);
    await user.type(et, '10:00');
    await user.click(screen.getByTestId('freeze-submit'));

    expect(await screen.findByText('The end must be after the start.')).toBeInTheDocument();
    expect(sent('POST', `${BASE}/freezes`)).toHaveLength(0);
  });

  it('past freezes stay out of the list until asked for', async () => {
    const past = { ...SALE, id: 'f-old', starts_at: '2020-01-01T00:00:00Z', ends_at: '2020-01-02T00:00:00Z', comment: 'old' };
    installFetchMock(routes({ freezes: { items: [past, SALE] } }));
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await screen.findByTestId('freeze-row-f-sale');
    expect(screen.queryByTestId('freeze-row-f-old')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('freeze-toggle-past'));
    expect(screen.getByTestId('freeze-row-f-old').textContent).toContain('past');
  });

  it('copies windows from another incarnation, one POST per source window', async () => {
    installFetchMock(
      routes({
        windows: { items: [], status: { open_now: true, next_start: '2026-10-27T10:00:00Z' } },
        extra: [
          { method: 'GET', url: '/v1/incarnations?', body: { items: [], offset: 0, limit: 500, total: 0 } },
          { method: 'GET', url: '/v1/incarnations/df-stage/maintenance-windows', body: { items: [NIGHT, SUNDAY], status: CLOSED } },
          { method: 'POST', url: `${BASE}/maintenance-windows`, status: 201, body: NIGHT },
        ],
      }),
    );
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('mw-copy-open'));
    await user.type(screen.getByTestId('mw-copy-source'), 'df-stage');
    await user.click(screen.getByTestId('mw-copy-load'));
    expect((await screen.findByTestId('mw-copy-preview')).textContent).toContain('Mon–Fri');
    await user.click(screen.getByTestId('mw-copy-submit'));

    await waitFor(() => expect(sent('POST', `${BASE}/maintenance-windows`)).toHaveLength(2));
    expect(sent('POST', `${BASE}/maintenance-windows`).map((c) => c.body)).toEqual([
      { days: NIGHT.days, start_time: '02:00', duration_minutes: 180, timezone: 'Europe/Moscow', comment: 'night works' },
      { days: SUNDAY.days, start_time: '10:00', duration_minutes: 240, timezone: 'Europe/Moscow', comment: 'planned maintenance' },
    ]);
  });

  it('copy with "replace" creates the new windows before it removes the old ones', async () => {
    installFetchMock(
      routes({
        windows: { items: [SUNDAY], status: CLOSED },
        extra: [
          { method: 'GET', url: '/v1/incarnations?', body: { items: [], offset: 0, limit: 500, total: 0 } },
          { method: 'GET', url: '/v1/incarnations/df-stage/maintenance-windows', body: { items: [NIGHT], status: CLOSED } },
          { method: 'DELETE', url: `${BASE}/maintenance-windows/w-sun`, status: 204 },
          { method: 'POST', url: `${BASE}/maintenance-windows`, status: 201, body: NIGHT },
        ],
      }),
    );
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('mw-copy-open'));
    await user.type(screen.getByTestId('mw-copy-source'), 'df-stage');
    await user.click(screen.getByTestId('mw-copy-load'));
    await user.click(await screen.findByTestId('mw-copy-replace'));
    await user.click(screen.getByTestId('mw-copy-submit'));

    await waitFor(() => expect(sent('DELETE', `${BASE}/maintenance-windows/w-sun`)).toHaveLength(1));
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls;
    const order = calls.filter(([, i]) => i?.method === 'POST' || i?.method === 'DELETE').map(([, i]) => i?.method);
    expect(order).toEqual(['POST', 'DELETE']);
  });

  it('a failed create during "replace" leaves the old windows and says so', async () => {
    installFetchMock(
      routes({
        windows: { items: [SUNDAY], status: CLOSED },
        extra: [
          { method: 'GET', url: '/v1/incarnations?', body: { items: [], offset: 0, limit: 500, total: 0 } },
          { method: 'GET', url: '/v1/incarnations/df-stage/maintenance-windows', body: { items: [NIGHT], status: CLOSED } },
          { method: 'POST', url: `${BASE}/maintenance-windows`, status: 422, body: { title: 'Unprocessable', detail: 'too many windows' } },
        ],
      }),
    );
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('mw-copy-open'));
    await user.type(screen.getByTestId('mw-copy-source'), 'df-stage');
    await user.click(screen.getByTestId('mw-copy-load'));
    await user.click(await screen.findByTestId('mw-copy-replace'));
    await user.click(screen.getByTestId('mw-copy-submit'));

    expect(await screen.findByText(/creating 0 of 1 windows and removing 0 of 1 old ones/)).toBeInTheDocument();
    expect(sent('DELETE', BASE)).toHaveLength(0);
  });

  it('a Keeper without the endpoint degrades to a note, not a crash', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/me/permissions', body: WRITER },
      { method: 'GET', url: `${BASE}/maintenance-windows`, status: 404, body: { title: 'Not Found' } },
      { method: 'GET', url: `${BASE}/freezes`, status: 404, body: { title: 'Not Found' } },
    ]);
    renderWithProviders(<MaintenanceTab incarnationName="df-prod" />);
    expect(await screen.findByTestId('maintenance-degraded')).toBeInTheDocument();
  });
});
